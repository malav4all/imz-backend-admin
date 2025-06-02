import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsArray,
  IsMongoId,
} from 'class-validator';
import { UserStatus } from '../schema/user.schema';

export class CreateUserDto {
  //   @IsEnum(UserType)
  //   type: UserType;

  @IsOptional()
  @IsMongoId()
  accountId?: string;

  @IsOptional()
  @IsMongoId()
  groupId?: string;

  @IsString()
  username: string;

  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsString()
  lastName: string;

  @IsString()
  password: string;

  @IsEmail()
  email: string;

  @IsString()
  contactNo: string;

  @IsMongoId()
  roleId: string;

  @IsEnum(UserStatus)
  status: UserStatus;
}
