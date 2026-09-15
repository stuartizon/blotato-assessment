import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { CommentsModule } from './comments/comments.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { ReplyJobsModule } from './reply-jobs/reply-jobs.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    QueueModule,
    CommentsModule,
    ReplyJobsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
