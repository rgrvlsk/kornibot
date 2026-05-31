UPDATE birthday_cards
SET window_id = (
  SELECT MIN(kept.id)
  FROM birthday_windows duplicate
  JOIN birthday_windows kept
    ON kept.preset_key = duplicate.preset_key
   AND kept.starts_on = duplicate.starts_on
  WHERE duplicate.id = birthday_cards.window_id
    AND duplicate.preset_key IS NOT NULL
)
WHERE window_id IN (
  SELECT duplicate.id
  FROM birthday_windows duplicate
  JOIN (
    SELECT preset_key, starts_on, MIN(id) AS keep_id
    FROM birthday_windows
    WHERE preset_key IS NOT NULL
    GROUP BY preset_key, starts_on
    HAVING COUNT(*) > 1
  ) grouped
    ON grouped.preset_key = duplicate.preset_key
   AND grouped.starts_on = duplicate.starts_on
  WHERE duplicate.id <> grouped.keep_id
);

DELETE FROM birthday_windows
WHERE id IN (
  SELECT duplicate.id
  FROM birthday_windows duplicate
  JOIN (
    SELECT preset_key, starts_on, MIN(id) AS keep_id
    FROM birthday_windows
    WHERE preset_key IS NOT NULL
    GROUP BY preset_key, starts_on
    HAVING COUNT(*) > 1
  ) grouped
    ON grouped.preset_key = duplicate.preset_key
   AND grouped.starts_on = duplicate.starts_on
  WHERE duplicate.id <> grouped.keep_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_birthday_windows_preset_start_unique
  ON birthday_windows(preset_key, starts_on)
  WHERE preset_key IS NOT NULL;
