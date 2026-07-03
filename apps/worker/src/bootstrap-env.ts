/** Load env before any module reads process.env at import time. */
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';

loadEnv();
loadEnv({ path: join(process.cwd(), '..', '..', '.env') });
