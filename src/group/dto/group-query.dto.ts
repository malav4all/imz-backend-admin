import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from 'src/comman/pagination.dto';

export class GroupQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsString()
  groupType?: string;

  @IsOptional()
  @IsString()
  stateName?: string;

  @IsOptional()
  @IsString()
  cityName?: string;

  @IsOptional()
  @Type(() => String)
  @IsString()
  status?: string;
}
