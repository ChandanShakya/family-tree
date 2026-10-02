ALTER TABLE `persons` ADD `middleName` text;--> statement-breakpoint
DROP TRIGGER trg_persons_fts_insert;
--> statement-breakpoint
DROP TRIGGER trg_persons_fts_update;
--> statement-breakpoint
CREATE TRIGGER trg_persons_fts_insert AFTER INSERT ON persons WHEN NEW.deletedAt IS NULL BEGIN
  INSERT OR IGNORE INTO person_fts_map (personId) VALUES (NEW.id);
  INSERT INTO persons_fts (rowid, name, birthYear, place, personId, treeId)
    SELECT m.fts_id,
      trim(NEW.firstName || ' ' || coalesce(NEW.middleName,'') || ' ' || coalesce(NEW.lastName,'') || ' ' || coalesce(NEW.maidenName,'')),
      CASE WHEN NEW.birthDateNorm IS NULL OR substr(NEW.birthDateNorm,1,4) = '0000' THEN '' ELSE substr(NEW.birthDateNorm,1,4) END,
      trim(coalesce(NEW.birthPlace,'') || ' ' || coalesce(NEW.deathPlace,'')),
      NEW.id, NEW.treeId
    FROM person_fts_map m WHERE m.personId = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER trg_persons_fts_update AFTER UPDATE OF firstName, middleName, lastName, maidenName, birthDateNorm, birthPlace, deathPlace, deletedAt ON persons BEGIN
  DELETE FROM persons_fts WHERE rowid = (SELECT fts_id FROM person_fts_map WHERE personId = NEW.id);
  INSERT OR IGNORE INTO person_fts_map (personId) VALUES (NEW.id);
  INSERT INTO persons_fts (rowid, name, birthYear, place, personId, treeId)
    SELECT m.fts_id,
      trim(NEW.firstName || ' ' || coalesce(NEW.middleName,'') || ' ' || coalesce(NEW.lastName,'') || ' ' || coalesce(NEW.maidenName,'')),
      CASE WHEN NEW.birthDateNorm IS NULL OR substr(NEW.birthDateNorm,1,4) = '0000' THEN '' ELSE substr(NEW.birthDateNorm,1,4) END,
      trim(coalesce(NEW.birthPlace,'') || ' ' || coalesce(NEW.deathPlace,'')),
      NEW.id, NEW.treeId
    FROM person_fts_map m WHERE m.personId = NEW.id AND NEW.deletedAt IS NULL;
END;
