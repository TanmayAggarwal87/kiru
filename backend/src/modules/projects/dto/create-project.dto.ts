import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ description: 'Title of the project', example: 'Podcast Episode 42' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;
}
