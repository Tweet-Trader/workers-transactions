DROP TABLE IF EXISTS Transactions;
CREATE TABLE IF NOT EXISTS Transactions(
  id TEXT PRIMARY KEY,
  hash TEXT CHECK(length(hash) == 66),
  wallet_address TEXT CHECK(length(wallet_address) == 42) NOT NULL,
  twitter_id TEXT NOT NULL,
  token_address TEXT CHECK(length(token_address) == 42) NOT NULL,
  token_price REAL NOT NULL,
  decimals INTEGER NOT NULL,
  symbol TEXT NOT NULL, 
  amount_in BLOB NOT NULL,
  amount_out BLOB NOT NULL,
  swap_type TEXT CHECK(swap_type in ('BUY', 'SELL')) NOT NULL,
  block_number INTEGER NOT NULL
);
CREATE INDEX wallet_address_idx ON Transactions(wallet_address);
CREATE INDEX twitter_id_idx ON Transactions(twitter_id);
CREATE INDEX token_address_idx ON Transactions(token_address);
CREATE INDEX swap_type_idx ON Transactions(swap_type);