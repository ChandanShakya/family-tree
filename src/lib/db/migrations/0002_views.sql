CREATE VIEW visible_persons AS SELECT * FROM persons p WHERE p.deletedAt IS NULL AND NOT EXISTS (SELECT 1 FROM treeMembers m WHERE m.personId = p.id AND m.status <> 'active');
