import { IsOptional, IsString, IsBoolean, IsMongoId } from 'class-validator';

import { Transform } from 'class-transformer';
import { PaginationDto } from 'src/comman/pagination.dto';

export class DeviceOnboardingQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsMongoId()
  account?: string;

  @IsOptional()
  @IsMongoId()
  vehicle?: string;

  @IsOptional()
  @IsMongoId()
  driver?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  simOperator?: string;
}
