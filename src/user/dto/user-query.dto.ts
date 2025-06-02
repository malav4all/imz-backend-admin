import { IsOptional, IsString, IsEnum, IsMongoId } from 'class-validator';
import { PaginationDto } from 'src/comman/pagination.dto';
import { UserStatus, UserType } from '../schema/user.schema';

export class UserQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  search?: string;

  //   @IsOptional()
  //   @IsEnum(UserType)
  //   type?: UserType;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsMongoId()
  accountId?: string;

  @IsOptional()
  @IsMongoId()
  groupId?: string;
}
