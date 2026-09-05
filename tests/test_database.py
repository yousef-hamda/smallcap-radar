import unittest,sqlite3,pathlib
class DatabaseTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:');self.db.execute('PRAGMA foreign_keys=ON')
  for p in sorted(pathlib.Path('drizzle').glob('*.sql')):self.db.executescript(p.read_text())
  self.db.execute("INSERT INTO strategy_runs(id,created_at,updated_at,status,source,strategy_hash,total) VALUES('r','2026-01-01','2026-01-01','running','test','h',2)");self.db.commit()
 def test_stale_cursor_cannot_reacquire(self):
  q='UPDATE strategy_runs SET lease_until=? WHERE id=? AND lease_until<? AND offset=? AND retry_queue=?'
  self.assertEqual(self.db.execute(q,(90,'r',1,0,'[]')).rowcount,1)
  self.db.execute("UPDATE strategy_runs SET offset=2,lease_until=0 WHERE id='r'")
  self.assertEqual(self.db.execute(q,(92,'r',2,0,'[]')).rowcount,0)
 def test_stale_retry_queue_cannot_reacquire(self):
  self.db.execute("UPDATE strategy_runs SET offset=2,retry_queue='[{\"attempt\":1}]' WHERE id='r'")
  q='UPDATE strategy_runs SET lease_until=? WHERE id=? AND lease_until<? AND offset=? AND retry_queue=?'
  self.assertEqual(self.db.execute(q,(90,'r',1,2,'[]')).rowcount,0)
 def test_failed_batch_rolls_back_snapshot(self):
  self.db.commit()
  try:
   with self.db:
    self.db.execute("INSERT INTO fundamental_snapshots VALUES('s','r','A','now','{}','{}')")
    self.db.execute("INSERT INTO fundamental_snapshots VALUES('bad','missing-run','B','now','{}','{}')")
  except sqlite3.IntegrityError:pass
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM fundamental_snapshots').fetchone()[0],0)
if __name__=='__main__':unittest.main()
