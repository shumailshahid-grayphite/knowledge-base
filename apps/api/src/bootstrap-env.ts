/**
 * Side-effect module: load env BEFORE any other app module is evaluated.
 * Imported as the first non-reflect import in main.ts so that modules reading
 * process.env at definition time (LoggerModule, upload limits) see .env values.
 */
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';

loadEnv();
loadEnv({ path: join(process.cwd(), '..', '..', '.env') });
