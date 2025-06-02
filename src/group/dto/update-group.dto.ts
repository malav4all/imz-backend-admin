import {
  IsString,
  IsOptional,
  IsArray,
  IsMongoId,
  IsBoolean,
} from 'class-validator';

export class UpdateGroupDto {
  @IsString()
  @IsOptional()
  groupName?: string;

  @IsString()
  @IsOptional()
  groupType?: string;

  @IsArray()
  @IsOptional()
  @IsMongoId({ each: true })
  imei?: string[];

  @IsString()
  @IsOptional()
  stateName?: string;

  @IsString()
  @IsOptional()
  cityName?: string;

  @IsString()
  @IsOptional()
  remark?: string;

  @IsString()
  @IsOptional()
  contactNo?: string;

  @IsString()
  @IsOptional()
  status: string;
}
