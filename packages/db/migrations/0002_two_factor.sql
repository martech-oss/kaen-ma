CREATE TABLE twoFactor (
  id TEXT PRIMARY KEY NOT NULL,
  secret TEXT NOT NULL,
  backup_codes TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  verified INTEGER NOT NULL DEFAULT 1,
  failed_verification_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER
);
CREATE INDEX two_factor_secret_idx ON twoFactor(secret);
CREATE INDEX two_factor_user_idx ON twoFactor(user_id);
