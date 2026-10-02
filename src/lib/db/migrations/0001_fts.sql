CREATE TABLE person_fts_map (
  fts_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  personId TEXT NOT NULL UNIQUE REFERENCES persons(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE VIRTUAL TABLE persons_fts USING fts5(
  name, birthYear, place,
  personId UNINDEXED, treeId UNINDEXED,
  tokenize = "unicode61 remove_diacritics 2 tokenchars 'ऀँंःऺऻ़ऽािीुूृॄॅॆेैॉॊोौ्ॎॏ॒॑॓॔ॕॖॗॢॣ'",
  prefix = '2 3'
);
--> statement-breakpoint
CREATE TRIGGER trg_persons_fts_insert AFTER INSERT ON persons WHEN NEW.deletedAt IS NULL BEGIN
  INSERT OR IGNORE INTO person_fts_map (personId) VALUES (NEW.id);
  INSERT INTO persons_fts (rowid, name, birthYear, place, personId, treeId)
    SELECT m.fts_id,
      trim(NEW.firstName || ' ' || coalesce(NEW.lastName,'') || ' ' || coalesce(NEW.maidenName,'')),
      CASE WHEN NEW.birthDateNorm IS NULL OR substr(NEW.birthDateNorm,1,4) = '0000' THEN '' ELSE substr(NEW.birthDateNorm,1,4) END,
      trim(coalesce(NEW.birthPlace,'') || ' ' || coalesce(NEW.deathPlace,'')),
      NEW.id, NEW.treeId
    FROM person_fts_map m WHERE m.personId = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER trg_persons_fts_update AFTER UPDATE OF firstName, lastName, maidenName, birthDateNorm, birthPlace, deathPlace, deletedAt ON persons BEGIN
  DELETE FROM persons_fts WHERE rowid = (SELECT fts_id FROM person_fts_map WHERE personId = NEW.id);
  INSERT OR IGNORE INTO person_fts_map (personId) VALUES (NEW.id);
  INSERT INTO persons_fts (rowid, name, birthYear, place, personId, treeId)
    SELECT m.fts_id,
      trim(NEW.firstName || ' ' || coalesce(NEW.lastName,'') || ' ' || coalesce(NEW.maidenName,'')),
      CASE WHEN NEW.birthDateNorm IS NULL OR substr(NEW.birthDateNorm,1,4) = '0000' THEN '' ELSE substr(NEW.birthDateNorm,1,4) END,
      trim(coalesce(NEW.birthPlace,'') || ' ' || coalesce(NEW.deathPlace,'')),
      NEW.id, NEW.treeId
    FROM person_fts_map m WHERE m.personId = NEW.id AND NEW.deletedAt IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER trg_persons_fts_delete AFTER DELETE ON persons BEGIN
  DELETE FROM persons_fts WHERE rowid = (SELECT fts_id FROM person_fts_map WHERE personId = OLD.id);
END;
