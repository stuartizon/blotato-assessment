import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from './pg-pool.token';

@Injectable()
class PgPoolLifecycle implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(configService: ConfigService) {
    this.pool = new Pool({
      connectionString: configService.get<string>('DATABASE_URL'),
    });
  }

  onModuleDestroy(): Promise<void> {
    return this.pool.end();
  }
}

// Global so any feature module can inject PG_POOL without re-importing this
// module — see docs/schema.md ("plain node-postgres, no ORM").
@Global()
@Module({
  providers: [
    PgPoolLifecycle,
    {
      provide: PG_POOL,
      useFactory: (lifecycle: PgPoolLifecycle) => lifecycle.pool,
      inject: [PgPoolLifecycle],
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
