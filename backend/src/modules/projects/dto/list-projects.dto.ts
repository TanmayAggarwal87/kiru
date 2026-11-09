import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListProjectsQueryDto {
  @ApiPropertyOptional({ description: 'Number of items to return (max 50)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Cursor for pagination (project UUID)' })
  @IsOptional()
  @IsUUID('4')
  cursor?: string;
}
