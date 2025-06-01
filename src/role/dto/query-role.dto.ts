import { IsOptional, IsEnum, IsString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from 'src/comman/pagination.dto';
import { UserRole } from '../schema/role-schema';

export class QueryRoleDto extends PaginationDto {
  @IsOptional()
  @IsEnum(UserRole)
  name?: UserRole;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isActive?: boolean;
}
