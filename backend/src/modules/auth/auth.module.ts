import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: SupabaseJwtGuard,
    },
  ],
  exports: [],
})
export class AuthModule {}
