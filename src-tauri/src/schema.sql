CREATE TABLE blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        placement TEXT NOT NULL CHECK (
          placement IN ('header', 'footer', 'left', 'right', 'center')
        ),
        position INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        font_size_px INTEGER NOT NULL DEFAULT 18 CHECK (font_size_px BETWEEN 12 AND 36),
        reset_frequency TEXT NOT NULL DEFAULT 'daily' CHECK (
          reset_frequency IN ('daily', 'weekly', 'monthly', 'yearly', 'never')
        ),
        template_content TEXT NOT NULL DEFAULT '',
        previous_entry_block_id INTEGER REFERENCES blocks(id) ON DELETE SET NULL,
        UNIQUE (placement, position)
      );

      CREATE TABLE entries (
        id TEXT PRIMARY KEY NOT NULL,
        block_id INTEGER NOT NULL REFERENCES blocks(id),
        entry_date TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX entries_block_date_updated ON entries (block_id, entry_date, updated_at);

      CREATE TABLE user_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        center_orientation TEXT NOT NULL CHECK (
          center_orientation IN ('horizontal', 'vertical', 'grid')
        ),
        header_size_px INTEGER NOT NULL CHECK (header_size_px BETWEEN 32 AND 10000),
        footer_size_px INTEGER NOT NULL CHECK (footer_size_px BETWEEN 32 AND 10000),
        left_size_px INTEGER NOT NULL CHECK (left_size_px BETWEEN 64 AND 10000),
        right_size_px INTEGER NOT NULL CHECK (right_size_px BETWEEN 64 AND 10000),
        center_sizes TEXT NOT NULL,
        font_family TEXT NOT NULL CHECK (
          font_family IN ('handlee', 'arial', 'georgia', 'trebuchet', 'verdana', 'courier')
        ),
        color_scheme TEXT NOT NULL CHECK (
          color_scheme IN ('paper', 'stone', 'sage', 'lavender', 'midnight', 'charcoal')
        )
      );

      INSERT INTO blocks (label, placement, position)
      VALUES
        ('Notes', 'center', 0),
        ('Tasks', 'right', 0);

      INSERT INTO user_settings
        (id, center_orientation, header_size_px, footer_size_px,
         left_size_px, right_size_px, center_sizes, font_family, color_scheme)
      VALUES (1, 'vertical', 140, 140,
              260, 280, '{}', 'handlee', 'paper');
UPDATE blocks SET template_content = '- [ ] Pick today''s main task
- [ ] Take a short break' WHERE label = 'Tasks';
