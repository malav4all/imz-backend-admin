import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  IsMongoId,
  ArrayMinSize,
} from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  groupName: string;

  @IsString()
  @IsNotEmpty()
  groupType: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  imei: string[];

  @IsString()
  @IsNotEmpty()
  stateName: string;

  @IsString()
  @IsNotEmpty()
  cityName: string;

  @IsString()
  @IsOptional()
  remark?: string;

  @IsString()
  @IsNotEmpty()
  contactNo: string;

  @IsString()
  @IsNotEmpty()
  status: string;
}
