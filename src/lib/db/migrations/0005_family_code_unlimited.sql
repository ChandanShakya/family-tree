-- Family codes are unlimited (D-034); direct codes stay single-use.
UPDATE `joinCodes` SET `maxUses` = NULL WHERE `type` = 'family';
