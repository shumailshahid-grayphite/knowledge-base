import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { LocalStorageProvider } from './local-storage.provider.js';
import { STORAGE_PROVIDER } from './storage.tokens.js';
import type { StorageProvider } from '@kb/shared';

/**
 * Selects the storage backend by config. MVP ships `local`; add s3/azure here
 * without touching consumers (they depend only on the StorageProvider interface).
 */
@Global()
@Module({
  providers: [
    LocalStorageProvider,
    {
      provide: STORAGE_PROVIDER,
      useFactory: (config: AppConfigService, local: LocalStorageProvider): StorageProvider => {
        switch (config.env.STORAGE_DRIVER) {
          case 'local':
            return local;
          default:
            throw new Error(`Unsupported STORAGE_DRIVER: ${config.env.STORAGE_DRIVER}`);
        }
      },
      inject: [AppConfigService, LocalStorageProvider],
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
