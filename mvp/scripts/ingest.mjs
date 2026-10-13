import { getConfig } from '../src/config.mjs';
import { Store } from '../src/storage.mjs';
import { startIngestion, ingestionStatus } from '../src/ingest.mjs';

const config = getConfig();
const store = new Store(config);
const timer = setInterval(() => console.log(`${ingestionStatus.processed}/${ingestionStatus.total} ${ingestionStatus.current}`), 10000);
try {
  const result = await startIngestion(store, config.dataDir);
  console.log(JSON.stringify({ processed: result.processed, total: result.total, errors: result.errors, sources: store.sources().length }, null, 2));
} finally { clearInterval(timer); store.close(); }
