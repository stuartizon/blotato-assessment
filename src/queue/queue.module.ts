import {
  Global,
  Injectable,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as PgBoss from 'pg-boss';
import { PG_BOSS } from './pg-boss.token';

@Injectable()
class PgBossLifecycle implements OnModuleInit, OnModuleDestroy {
  readonly boss: PgBoss;

  constructor(configService: ConfigService) {
    this.boss = new PgBoss(configService.get<string>('DATABASE_URL')!);
  }

  onModuleInit(): Promise<PgBoss> {
    return this.boss.start();
  }

  onModuleDestroy(): Promise<void> {
    return this.boss.stop();
  }
}

// Global so any feature module can inject PG_BOSS without re-importing this
// module — mirrors DatabaseModule's PG_POOL wiring. The reply-job queue is
// the only consumer today (see docs/ASSUMPTIONS.md, "Async reply pipeline"),
// but new job types would share this same boss instance rather than each
// standing up their own.
@Global()
@Module({
  providers: [
    PgBossLifecycle,
    {
      provide: PG_BOSS,
      useFactory: (lifecycle: PgBossLifecycle) => lifecycle.boss,
      inject: [PgBossLifecycle],
    },
  ],
  exports: [PG_BOSS],
})
export class QueueModule {}
