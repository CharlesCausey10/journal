use anyhow::{bail, ensure, Context, Result};
use rusqlite::{Connection, DatabaseName, OpenFlags};
use serde_json::Value;
use std::{fs, path::Path};
use uuid::Uuid;

const FILE: &str = "journal.sqlite";
const SCHEMA: &str = include_str!("schema.sql");
const CHECKLIST:&str="ALTER TABLE user_settings ADD COLUMN move_checked_to_bottom INTEGER NOT NULL DEFAULT 0 CHECK(move_checked_to_bottom IN (0,1));";
fn check(db: &Connection) -> Result<()> {
    let health: String = db.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    ensure!(health == "ok", "Database integrity check failed: {health}");
    ensure!(
        !db.prepare("PRAGMA foreign_key_check")?.exists([])?,
        "Database contains broken relationships"
    );
    Ok(())
}
fn columns(db: &Connection, table: &str) -> Result<Vec<String>> {
    let mut query = db.prepare("SELECT name FROM pragma_table_info(?)")?;
    let result = query
        .query_map([table], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(result)
}
fn upgrade(db: &mut Connection, version: i64, before: Option<&Path>) -> Result<()> {
    if let Some(backup) = before {
        db.execute(
            "ATTACH DATABASE ? AS original",
            [backup.to_str().context("Invalid backup path")?],
        )?;
    }
    let tx = db.transaction()?;
    match version {
        0 => {
            ensure!(
                !tx.prepare("SELECT 1 FROM sqlite_master WHERE type='table'")?
                    .exists([])?,
                "Unknown unversioned journal database"
            );
            tx.execute_batch(SCHEMA)?;
        }
        1 => {
            let fields = columns(&tx, "blocks")?;
            for (name,def) in [
                ("font_size_px","INTEGER NOT NULL DEFAULT 18 CHECK(font_size_px BETWEEN 12 AND 36)"),
                ("reset_frequency","TEXT NOT NULL DEFAULT 'daily' CHECK(reset_frequency IN ('daily','weekly','monthly','yearly','never'))"),
                ("template_content","TEXT NOT NULL DEFAULT ''"),
                ("previous_entry_block_id","INTEGER REFERENCES blocks(id) ON DELETE SET NULL")
            ]{
                if !fields.iter().any(|f|f==name){
                    tx.execute_batch(&format!("ALTER TABLE blocks ADD COLUMN {name} {def}"))?;
                    if name=="template_content"{
                        tx.execute("UPDATE blocks SET template_content=? WHERE placement='right' AND label='Tasks'",["- [ ] Pick today's main task\n- [ ] Take a short break"])?;
                    }
                }
            }
            let fields = columns(&tx, "user_settings")?;
            let definition = SCHEMA
                .split("CREATE TABLE user_settings (")
                .nth(1)
                .unwrap()
                .split(");")
                .next()
                .unwrap();
            tx.execute_batch(&format!("CREATE TABLE new_settings ({definition});"))?;
            let checklist = fields.iter().any(|f| f == "move_checked_to_bottom");
            if checklist {
                tx.execute_batch(&CHECKLIST.replace("user_settings", "new_settings"))?;
            }
            let extra = if checklist {
                ",move_checked_to_bottom"
            } else {
                ""
            };
            let color = if fields.iter().any(|f| f == "color_scheme") {
                "color_scheme"
            } else {
                "'paper'"
            };
            tx.execute_batch(&format!("INSERT INTO new_settings SELECT id,center_orientation,header_size_px,footer_size_px,left_size_px,right_size_px,center_sizes,font_family,{color}{extra} FROM user_settings; DROP TABLE user_settings; ALTER TABLE new_settings RENAME TO user_settings;"))?;
        }
        2 | 3 => {}
        _ => bail!("Unsupported journal database version {version}"),
    }
    tx.execute_batch("CREATE INDEX IF NOT EXISTS entries_block_date_updated ON entries(block_id,entry_date,updated_at)")?;
    if !columns(&tx, "user_settings")?
        .iter()
        .any(|f| f == "move_checked_to_bottom")
    {
        tx.execute_batch(CHECKLIST)?;
    }
    tx.pragma_update(None, "user_version", 4)?;
    validate_schema(&tx)?;
    if before.is_some() {
        preserved(&tx)?;
    }
    check(&tx)?;
    tx.commit()?;
    if before.is_some() {
        db.execute_batch("DETACH DATABASE original")?;
    }
    Ok(())
}
fn validate_schema(db: &Connection) -> Result<()> {
    let definition: String = db.query_row(
        "SELECT sql FROM sqlite_master WHERE name='user_settings'",
        [],
        |r| r.get(0),
    )?;
    for fragment in [
        "'grid'",
        "'midnight'",
        "'charcoal'",
        "header_size_px BETWEEN 32 AND 10000",
        "footer_size_px BETWEEN 32 AND 10000",
        "left_size_px BETWEEN 64 AND 10000",
        "right_size_px BETWEEN 64 AND 10000",
    ] {
        ensure!(
            definition.contains(fragment),
            "Unsupported or damaged settings schema"
        );
    }
    for (table,names) in [("blocks","id label placement position is_active font_size_px reset_frequency template_content previous_entry_block_id"),("entries","id block_id entry_date content created_at updated_at"),("user_settings","id center_orientation header_size_px footer_size_px left_size_px right_size_px center_sizes font_family color_scheme move_checked_to_bottom")]{
        let fields=columns(db,table)?;
        for name in names.split_whitespace(){ensure!(fields.iter().any(|f|f==name),"Missing {table}.{name}");}
    }
    ensure!(
        db.prepare("SELECT id FROM user_settings WHERE id=1")?
            .exists([])?,
        "Journal settings are missing"
    );
    Ok(())
}
fn preserved(db: &Connection) -> Result<()> {
    for table in ["entries", "blocks", "user_settings"] {
        let mut q = db.prepare("SELECT name FROM pragma_table_info(?, 'original')")?;
        let names = q
            .query_map([table], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let fields = names
            .iter()
            .filter(|n| !(table == "user_settings" && n.as_str() == "gap_px"))
            .map(|n| format!("\"{}\"", n.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(",");
        let mismatch:bool=db.query_row(&format!("SELECT (SELECT count(*) FROM original.{table}) != (SELECT count(*) FROM main.{table}) OR EXISTS(SELECT {fields} FROM original.{table} EXCEPT SELECT {fields} FROM main.{table})"),[],|r|r.get(0))?;
        ensure!(
            !mismatch,
            "Migration could not verify the contents of {table}"
        );
    }
    Ok(())
}
fn check_history(dir: &Path) -> Result<()> {
    let root = dir.join("backups/migrations");
    if root.exists() {
        for entry in fs::read_dir(root)? {
            let p = entry?.path();
            if !p.is_dir() {
                continue;
            }
            let manifest: Value = serde_json::from_slice(
                &fs::read(p.join("manifest.json"))
                    .context("An earlier migration was interrupted")?,
            )?;
            ensure!(
                matches!(
                    manifest["status"].as_str(),
                    Some("complete" | "acknowledged" | "superseded")
                ),
                "An earlier migration needs recovery in {}",
                dir.display()
            );
        }
    }
    Ok(())
}
fn snapshot(source: &Connection, destination: &Path) -> Result<()> {
    let version: i64 = source.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    ensure!(
        (1..=4).contains(&version),
        "The selected journal has an unsupported or missing schema version ({version})"
    );
    source.backup(DatabaseName::Main, destination, None)?;
    check(&Connection::open_with_flags(
        destination,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?)
}
fn prepare(path: &Path, dir: &Path) -> Result<Connection> {
    let fresh = !path.try_exists()?;
    let mut db = Connection::open(path)?;
    db.pragma_update(None, "foreign_keys", "ON")?;
    let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    ensure!(
        fresh || version != 0,
        "The existing database is empty or unversioned. Restore a backup to continue."
    );
    let marker = dir.join("upgrade-pending");
    if version == 4 {
        if marker.try_exists()? {
            let id = Uuid::parse_str(&fs::read_to_string(&marker)?)?;
            let folder = dir.join("backups/tauri").join(id.to_string());
            db.execute(
                "ATTACH DATABASE ? AS original",
                [folder
                    .join("before.sqlite")
                    .to_str()
                    .context("Invalid backup path")?],
            )?;
            preserved(&db)?;
            db.execute_batch("DETACH DATABASE original")?;
            snapshot(&db, &folder.join("after.sqlite"))?;
            fs::remove_file(&marker)?;
        }
        let health: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        ensure!(health == "ok", "Database integrity check failed");
    } else {
        ensure!(
            (0..4).contains(&version),
            "Unsupported database version {version}. Open it with a compatible Journal release."
        );
        let backup = if version > 0 {
            let id = Uuid::new_v4().to_string();
            let p = dir.join("backups/tauri").join(&id);
            fs::create_dir_all(&p)?;
            snapshot(&db, &p.join("before.sqlite"))?;
            fs::write(&marker, id)?;
            Some(p)
        } else {
            None
        };
        let before = backup.as_ref().map(|p| p.join("before.sqlite"));
        upgrade(&mut db, version, before.as_deref())?;
        if let Some(p) = backup {
            snapshot(&db, &p.join("after.sqlite"))?;
            fs::remove_file(&marker)?;
        }
    }
    validate_schema(&db)?;
    super::journal::request(&mut db, "ready", &Value::Null)?;
    Ok(db)
}
pub fn open(dir: &Path) -> Result<Connection> {
    fs::create_dir_all(dir)?;
    let path = dir.join(FILE);
    ensure!(
        !dir.join("restore-pending").exists(),
        "A restore was interrupted. Select a verified backup to continue."
    );
    if !path.try_exists()? {
        ensure!(
            !dir.join("initialized").exists()
                && !dir.join("backups").exists()
                && !dir.join("journal.sqlite-wal").exists(),
            "The active database is missing. Restore a backup to continue."
        );
        let staged = dir.join(format!("import-{}.sqlite", Uuid::new_v4()));
        let db = prepare(&staged, dir)?;
        db.close().map_err(|(_, e)| e)?;
        fs::rename(&staged, &path)?;
    }
    check_history(dir)?;
    let db = prepare(&path, dir)?;
    db.pragma_update(None, "journal_mode", "WAL")?;
    fs::write(dir.join("initialized"), b"4")?;
    Ok(db)
}

pub fn restore(dir: &Path, selected: &Path) -> Result<()> {
    fs::create_dir_all(dir)?;
    let archive = dir
        .join("backups/recovery")
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&archive)?;

    let source = Connection::open_with_flags(&selected, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let replacement = archive.join("replacement.sqlite");
    snapshot(&source, &replacement)?;
    drop(source);
    drop(prepare(&replacement, &archive)?);
    fs::write(
        dir.join("restore-pending"),
        archive.to_string_lossy().as_bytes(),
    )?;
    for name in [
        "upgrade-pending",
        FILE,
        "journal.sqlite-wal",
        "journal.sqlite-shm",
        "journal.sqlite-journal",
    ] {
        let original = dir.join(name);
        if original.try_exists()? {
            fs::rename(original, archive.join(name))?;
        }
    }
    if dir.join("backups/migrations").try_exists()? {
        fs::rename(
            dir.join("backups/migrations"),
            archive.join("previous-migrations"),
        )?;
    }
    fs::rename(replacement, dir.join(FILE))?;
    fs::write(dir.join("initialized"), b"4")?;
    fs::remove_file(dir.join("restore-pending"))?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::journal::request;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn saved_entries_and_preferences_reopen_from_native_data_folder() -> Result<()> {
        let directory = tempdir()?;
        let mut db = open(directory.path())?;
        request(
            &mut db,
            "entries:save",
            &json!({
                "id": "saved", "blockId": 1, "entryDate": "2099-01-01", "content": "Saved journal text"
            }),
        )?;
        request(&mut db, "settings:set-color-scheme", &json!("sage"))?;
        drop(db);
        let mut reopened = open(directory.path())?;
        assert_eq!(
            request(&mut reopened, "entries:get", &json!("saved"))?["content"],
            "Saved journal text"
        );
        assert_eq!(
            request(&mut reopened, "layout:get", &Value::Null)?["colorScheme"],
            "sage"
        );
        Ok(())
    }

    #[test]
    fn upgrades_older_schemas_with_verified_snapshots() -> Result<()> {
        for version in [1, 2, 3] {
            let root = tempdir()?;
            let old = root.path().join("old");
            fs::create_dir_all(&old)?;
            let db = Connection::open(old.join(FILE))?;
            db.execute_batch(SCHEMA)?;
            db.execute_batch("INSERT INTO entries VALUES ('archived',1,'2020-03-03','previous journal','created','updated');")?;
            if version == 1 {
                db.execute_batch("ALTER TABLE blocks DROP COLUMN previous_entry_block_id; ALTER TABLE blocks DROP COLUMN template_content; ALTER TABLE blocks DROP COLUMN reset_frequency; ALTER TABLE blocks DROP COLUMN font_size_px; ALTER TABLE user_settings ADD COLUMN gap_px INTEGER DEFAULT 10;")?;
            }
            db.pragma_update(None, "user_version", version)?;
            drop(db);
            let mut db = open(&old)?;
            assert_eq!(
                request(&mut db, "entries:get", &json!("archived"))?["content"],
                "previous journal"
            );
            let folder = fs::read_dir(old.join("backups/tauri"))?
                .next()
                .unwrap()?
                .path();
            assert!(folder.join("before.sqlite").exists() && folder.join("after.sqlite").exists());
            assert_eq!(
                Connection::open(old.join(FILE))?
                    .query_row("pragma user_version", [], |r| r.get::<_, i64>(0))?,
                4
            );
        }
        Ok(())
    }

    #[test]
    fn block_settings_history_and_layout_roundtrip() -> Result<()> {
        let root = tempdir()?;
        let mut db = open(root.path())?;
        let linked = request(
            &mut db,
            "blocks:add",
            &json!({"label":"Yesterday","placement":"center"}),
        )?["id"]
            .clone();
        request(
            &mut db,
            "blocks:update-settings",
            &json!({"id":linked,"settings":{"previousEntryBlockId":1},"anchorDate":"2099-01-01"}),
        )?;
        db.execute(
            "INSERT INTO entries VALUES('y',1,'2002-01-01','historical','a','a')",
            [],
        )?;
        let earlier = request(&mut db, "entries:list-for-date", &json!("2002-01-02"))?;
        assert_eq!(earlier[0]["blockId"], linked);
        assert!(request(&mut db, "entries:delete", &json!("y")).is_err());
        assert!(request(
            &mut db,
            "entries:save",
            &json!({"blockId":linked,"entryDate":"2099-01-01","content":"no"})
        )
        .is_err());
        request(
            &mut db,
            "blocks:move",
            &json!({"id":linked,"placement":"right","position":0}),
        )?;
        request(
            &mut db,
            "layout:set-size",
            &json!({"placement":"center","blockId":1,"sizeValue":2.5}),
        )?;
        request(
            &mut db,
            "blocks:update-settings",
            &json!({"id":1,"settings":{"resetFrequency":"weekly","fontSizePx":20,"templateContent":"default"},"anchorDate":"2099-01-01"}),
        )?;
        let entry = request(
            &mut db,
            "entries:save",
            &json!({"id":"future","blockId":1,"entryDate":"2099-01-01","content":"week"}),
        )?;
        assert_eq!(entry["entryDate"], "2098-12-29");
        assert!(request(
            &mut db,
            "entries:save",
            &json!({"id":"future","blockId":1,"entryDate":"2099-02-01","content":"wrong period"})
        )
        .is_err());
        assert_eq!(
            request(&mut db, "layout:get", &Value::Null)?["centerSizes"]["1"],
            2.5
        );
        request(&mut db, "blocks:remove", &json!(1))?;
        assert!(request(&mut db, "blocks:list", &Value::Null)?
            .as_array()
            .unwrap()
            .iter()
            .all(|x| x["previousEntryBlockId"].is_null()));
        Ok(())
    }

    #[test]
    fn failed_import_and_restore_do_not_replace_data() -> Result<()> {
        let root = tempdir()?;
        let damaged = root.path().join("damaged");
        fs::create_dir_all(&damaged)?;
        fs::write(damaged.join(FILE), b"damaged")?;
        let dest = root.path().join("dest");
        fs::create_dir_all(&dest)?;
        fs::write(dest.join(FILE), b"damaged")?;
        assert!(open(&dest).is_err());
        fs::remove_file(dest.join(FILE))?;
        let backup = root.path().join("backup.sqlite");
        let mut good = open(&dest)?;
        request(&mut good, "settings:set-color-scheme", &json!("sage"))?;
        snapshot(&good, &backup)?;
        drop(good);
        assert!(restore(&dest, &damaged.join(FILE)).is_err());
        fs::write(dest.join(FILE), b"damaged")?;
        restore(&dest, &backup)?;
        assert_eq!(
            request(&mut open(&dest)?, "layout:get", &Value::Null)?["colorScheme"],
            "sage"
        );
        let recovery = dest.join("backups/recovery");
        assert!(fs::read_dir(recovery)?
            .filter_map(|e| e.ok())
            .any(|e| fs::read(e.path().join(FILE)).ok().as_deref() == Some(b"damaged")));
        Ok(())
    }

    #[test]
    fn missing_damaged_and_future_journals_require_recovery() -> Result<()> {
        let root = tempdir()?;
        fs::write(root.path().join(FILE), [])?;
        assert!(open(root.path()).is_err());
        assert_eq!(fs::metadata(root.path().join(FILE))?.len(), 0);
        let db = Connection::open(root.path().join(FILE))?;
        db.pragma_update(None, "user_version", 800)?;
        drop(db);
        assert!(open(root.path()).is_err());
        fs::remove_file(root.path().join(FILE))?;
        fs::create_dir_all(root.path().join("backups"))?;
        assert!(open(root.path()).is_err());
        assert!(!root.path().join(FILE).exists());
        Ok(())
    }
}
