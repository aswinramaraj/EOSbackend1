import { ArrayMinSize, IsArray, IsInt, IsPositive } from 'class-validator';

export class AddGroupMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  studentUserIds: number[];
}
