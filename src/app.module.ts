import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { CommentsModule } from './comments/comments.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), CommentsModule],
  controllers: [AppController],
})
export class AppModule {}
