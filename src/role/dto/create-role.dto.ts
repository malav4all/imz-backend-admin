import {
  IsEnum,
  IsString,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Module, Permission, UserRole } from '../schema/role-schema';
import { StatusType } from 'src/driver/schema/driver.schema';

export class ModulePermissionDto {
  @IsEnum(Module)
  module: Module;

  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions: Permission[];
}

export class CreateRoleDto {
  @IsEnum(UserRole)
  name: UserRole;

  @IsString()
  displayName: string;

  @IsString()
  description: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModulePermissionDto)
  modulePermissions: ModulePermissionDto[];

  @IsEnum(StatusType)
  status: StatusType;
}
