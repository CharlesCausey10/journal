use anyhow::{bail, ensure, Context, Result};
use chrono::{Datelike, Days, Local, NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, types::ValueRef, Connection, Params};
use serde_json::{json, Map, Value};
use uuid::Uuid;

const BLOCK: &str = "SELECT id, label, placement, position, font_size_px AS fontSizePx,
    reset_frequency AS resetFrequency, template_content AS templateContent,
    previous_entry_block_id AS previousEntryBlockId FROM blocks";
const ENTRY: &str = "SELECT id, block_id AS blockId, entry_date AS entryDate, content,
    created_at AS createdAt, updated_at AS updatedAt FROM entries";
const LAYOUT: &str =
    "SELECT center_orientation AS centerOrientation, header_size_px AS headerSizePx,
    footer_size_px AS footerSizePx, left_size_px AS leftSizePx, right_size_px AS rightSizePx,
    center_sizes AS centerSizes, font_family AS fontFamily, color_scheme AS colorScheme,
    move_checked_to_bottom AS moveCheckedToBottom FROM user_settings WHERE id=1";

fn rows(db: &Connection, sql: &str, args: impl Params) -> Result<Vec<Value>> {
    let mut query = db.prepare(sql)?;
    let names = query
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>();
    let mut cursor = query.query(args)?;
    let mut result = Vec::new();
    while let Some(row) = cursor.next()? {
        let mut object = Map::new();
        for (i, name) in names.iter().enumerate() {
            let value = match row.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => json!(n),
                ValueRef::Real(n) => json!(n),
                ValueRef::Text(s) => json!(std::str::from_utf8(s)?),
                ValueRef::Blob(_) => bail!("Unexpected binary journal field"),
            };
            object.insert(name.clone(), value);
        }
        result.push(Value::Object(object));
    }
    Ok(result)
}
fn string(v: &Value) -> Result<&str> {
    v.as_str().context("Expected text")
}
fn integer(v: &Value) -> Result<i64> {
    v.as_i64().context("Expected an integer")
}
fn block(db: &Connection, id: i64) -> Result<Value> {
    rows(db, &format!("{BLOCK} WHERE id=? AND is_active=1"), [id])?
        .pop()
        .context("Panel is unavailable")
}
fn blocks(db: &Connection) -> Result<Vec<Value>> {
    rows(
        db,
        &format!("{BLOCK} WHERE is_active=1 ORDER BY placement,position"),
        [],
    )
}
fn entry(db: &Connection, id: &str) -> Result<Value> {
    Ok(rows(db, &format!("{ENTRY} WHERE id=?"), [id])?
        .pop()
        .unwrap_or(Value::Null))
}
fn layout(db: &Connection) -> Result<Value> {
    let mut row = rows(db, LAYOUT, [])?
        .pop()
        .context("Missing journal settings")?;
    row["centerSizes"] = serde_json::from_str(string(&row["centerSizes"])?)?;
    ensure!(row["centerSizes"].is_object(), "Invalid center sizes");
    row["moveCheckedToBottom"] = json!(integer(&row["moveCheckedToBottom"])? == 1);
    Ok(row)
}
fn placement(input: &Value) -> Result<&str> {
    let placement = string(&input["placement"])?;
    ensure!(
        matches!(placement, "center" | "left" | "right" | "header" | "footer"),
        "Invalid panel placement"
    );
    Ok(placement)
}
fn period(date: &str, frequency: &str) -> Result<String> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d")?;
    ensure!(d.to_string() == date, "Invalid journal date");
    Ok(match frequency {
        "daily" => date.to_owned(),
        "weekly" => d
            .checked_sub_days(Days::new(d.weekday().num_days_from_monday().into()))
            .context("Invalid week")?
            .to_string(),
        "monthly" => format!("{}-01", &date[..7]),
        "yearly" => format!("{}-01-01", &date[..4]),
        "never" => "0001-01-01".to_owned(),
        _ => bail!("Invalid reset frequency"),
    })
}
fn today() -> String {
    Local::now().date_naive().to_string()
}
fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn label(v: &Value) -> Result<&str> {
    let name = string(v)?.trim();
    ensure!(
        (1..=40).contains(&name.encode_utf16().count()),
        "Panel title must be 1 to 40 characters"
    );
    Ok(name)
}

fn entries_for_date(db: &Connection, date: &str) -> Result<Value> {
    let panels = blocks(db)?;
    let mut result = Vec::new();
    for panel in &panels {
        let linked = &panel["previousEntryBlockId"];
        let (source, filter) = if linked.is_null() {
            (panel, "entry_date=? ORDER BY updated_at DESC")
        } else {
            let Some(source) = panels
                .iter()
                .find(|p| p["id"] == *linked && p["previousEntryBlockId"].is_null())
            else {
                continue;
            };
            (
                source,
                "entry_date<? AND length(trim(content))>0 ORDER BY entry_date DESC,updated_at DESC",
            )
        };
        let key = period(date, string(&source["resetFrequency"])?)?;
        if let Some(mut row) = rows(
            db,
            &format!("{ENTRY} WHERE block_id=? AND {filter} LIMIT 1"),
            params![integer(&source["id"])?, key],
        )?
        .pop()
        {
            row["blockId"] = panel["id"].clone();
            result.push(row);
        }
    }
    Ok(json!(result))
}
fn save(db: &Connection, input: &Value) -> Result<Value> {
    let date = string(&input["entryDate"])?;
    ensure!(
        date >= today().as_str(),
        "Past journal entries are read-only"
    );
    let panel = block(db, integer(&input["blockId"])?)?;
    ensure!(
        panel["previousEntryBlockId"].is_null(),
        "Linked journal blocks are read-only"
    );
    let key = period(date, string(&panel["resetFrequency"])?)?;
    let id = input["id"]
        .as_str()
        .map(String::from)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let existing = entry(db, &id)?;
    ensure!(
        existing.is_null() || (existing["blockId"] == panel["id"] && existing["entryDate"] == key),
        "An existing entry cannot be moved to another block or period"
    );
    db.execute("INSERT INTO entries(id,block_id,entry_date,content,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5) ON CONFLICT(id) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at",params![id,integer(&panel["id"])?,key,string(&input["content"])?,now()])?;
    entry(db, &id)
}
fn settings(db: &Connection, input: &Value) -> Result<Value> {
    let id = integer(&input["id"])?;
    let previous = block(db, id)?;
    let mut next = previous.clone();
    for field in [
        "label",
        "fontSizePx",
        "resetFrequency",
        "templateContent",
        "previousEntryBlockId",
    ] {
        if let Some(v) = input["settings"].get(field) {
            next[field] = v.clone();
        }
    }
    let source = next["previousEntryBlockId"].as_i64();
    if !next["previousEntryBlockId"].is_null() {
        let src = source.context("Invalid linked panel")?;
        ensure!(
            src != id && block(db, src)?["previousEntryBlockId"].is_null(),
            "Invalid linked panel"
        );
    }
    let template = string(&next["templateContent"])?;
    ensure!(
        template.encode_utf16().count() <= 20000,
        "Template exceeds 20,000 characters"
    );
    if previous["resetFrequency"] != next["resetFrequency"] {
        let date = today().max(string(&input["anchorDate"])?.into());
        db.execute(
            "UPDATE entries SET entry_date=?, updated_at=? WHERE block_id=? AND entry_date=?",
            params![
                period(&date, string(&next["resetFrequency"])?)?,
                now(),
                id,
                period(&date, string(&previous["resetFrequency"])?)?
            ],
        )?;
    }
    db.execute("UPDATE blocks SET label=?,font_size_px=?,reset_frequency=?,template_content=?,previous_entry_block_id=? WHERE id=?",params![label(&next["label"])?,integer(&next["fontSizePx"])?,string(&next["resetFrequency"])?,template,source,id])?;
    block(db, id)
}
fn move_panel(db: &Connection, input: &Value) -> Result<Value> {
    let id = integer(&input["id"])?;
    let panel = block(db, id)?;
    let old = string(&panel["placement"])?;
    let target = placement(input)?;
    let pos = usize::try_from(integer(&input["position"])?)?;
    let affected=rows(db,"SELECT id,placement,is_active FROM blocks WHERE placement=? OR placement=? ORDER BY is_active DESC,position",params![old,target])?;
    db.execute(
        "UPDATE blocks SET position=-id WHERE placement=? OR placement=?",
        params![old, target],
    )?;
    let placements = if old == target {
        vec![target]
    } else {
        vec![old, target]
    };
    for placement in placements {
        let mut ids = affected
            .iter()
            .filter(|p| p["placement"] == placement && p["id"] != id)
            .collect::<Vec<_>>();
        let count = ids.iter().take_while(|p| p["is_active"] == 1).count();
        if placement == target {
            ids.insert(pos.min(count), &panel);
        }
        for (i, p) in ids.iter().enumerate() {
            db.execute(
                "UPDATE blocks SET placement=?,position=? WHERE id=?",
                params![placement, i, integer(&p["id"])?],
            )?;
        }
    }
    Ok(json!(blocks(db)?))
}
fn resize(db: &Connection, input: &Value) -> Result<Value> {
    let placement = string(&input["placement"])?;
    let value = input["sizeValue"].as_f64().context("Invalid size")?;
    let size = match placement {
        "center" => {
            let id = integer(&input["blockId"])?;
            ensure!(
                block(db, id)?["placement"] == "center",
                "Unknown center block"
            );
            let size = value.clamp(0.01, 1000.);
            let mut sizes = layout(db)?["centerSizes"].clone();
            sizes[id.to_string()] = json!(size);
            db.execute(
                "UPDATE user_settings SET center_sizes=?",
                [sizes.to_string()],
            )?;
            size
        }
        "left" | "right" | "header" | "footer" => {
            let size = value.clamp(
                if matches!(placement, "left" | "right") {
                    64.
                } else {
                    32.
                },
                10000.,
            );
            db.execute(
                &format!("UPDATE user_settings SET {placement}_size_px=?"),
                [size],
            )?;
            size
        }
        _ => bail!("Invalid placement"),
    };
    Ok(json!(size))
}
pub fn request(db: &mut Connection, action: &str, input: &Value) -> Result<Value> {
    let tx = db.transaction()?;
    let result = match action {
        "ready" => {
            layout(&tx)?;
            blocks(&tx)?;
            tx.prepare(&format!("{ENTRY} LIMIT 0"))?;
            Value::Null
        }
        "entries:list" => json!(rows(&tx, &format!("{ENTRY} ORDER BY entry_date DESC"), [])?),
        "entries:list-for-date" => entries_for_date(&tx, string(input)?)?,
        "entries:get" => entry(&tx, string(input)?)?,
        "entries:save" => save(&tx, input)?,
        "entries:delete" => {
            let item = entry(&tx, string(input)?)?;
            if !item.is_null() {
                let freq: String = tx.query_row(
                    "SELECT reset_frequency FROM blocks WHERE id=?",
                    [integer(&item["blockId"])?],
                    |r| r.get(0),
                )?;
                ensure!(
                    string(&item["entryDate"])? >= period(&today(), &freq)?.as_str(),
                    "Past journal entries are read-only"
                );
            }
            json!(tx.execute("DELETE FROM entries WHERE id=?", [string(input)?])? > 0)
        }
        "blocks:list" => json!(blocks(&tx)?),
        "blocks:add" => {
            tx.execute("INSERT INTO blocks(label,placement,position) SELECT ?1,?2,coalesce(max(position)+1,0) FROM blocks WHERE placement=?2",params![label(&input["label"])?,placement(input)?])?;
            block(&tx, tx.last_insert_rowid())?
        }
        "blocks:remove" => {
            let id = integer(input)?;
            let removed = tx.execute(
                "UPDATE blocks SET is_active=0 WHERE id=? AND is_active=1",
                [id],
            )? > 0;
            tx.execute(
                "UPDATE blocks SET previous_entry_block_id=NULL WHERE previous_entry_block_id=?",
                [id],
            )?;
            json!(removed)
        }
        "blocks:move" => move_panel(&tx, input)?,
        "blocks:update-settings" => settings(&tx, input)?,
        "layout:get" => layout(&tx)?,
        "layout:set-size" => resize(&tx, input)?,
        "layout:set-center-orientation"
        | "settings:set-font-family"
        | "settings:set-color-scheme" => {
            let field = match action {
                "layout:set-center-orientation" => "center_orientation",
                "settings:set-font-family" => "font_family",
                _ => "color_scheme",
            };
            tx.execute(
                &format!("UPDATE user_settings SET {field}=?"),
                [string(input)?],
            )?;
            Value::Null
        }
        "settings:set-move-checked-to-bottom" => {
            tx.execute(
                "UPDATE user_settings SET move_checked_to_bottom=?",
                [input.as_bool().context("Invalid checklist setting")?],
            )?;
            Value::Null
        }
        _ => bail!("Unknown journal command"),
    };
    tx.commit()?;
    Ok(result)
}
