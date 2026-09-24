import { ArrayMinSize, IsArray, IsInt, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateGroupConversationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  studentUserIds: number[];
}
