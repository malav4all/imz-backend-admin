import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsMongoId,
  IsBoolean,
} from 'class-validator';

export class CreateDeviceOnboardingDto {
  @IsMongoId()
  @IsNotEmpty()
  account: string;

  @IsString()
  @IsNotEmpty()
  deviceIMEI: string;

  @IsString()
  @IsNotEmpty()
  deviceSerialNo: string;

  @IsString()
  @IsNotEmpty()
  simNo1: string;

  @IsString()
  @IsOptional()
  simNo2?: string;

  @IsString()
  @IsNotEmpty()
  simNo1Operator: string;

  @IsString()
  @IsOptional()
  simNo2Operator?: string;

  @IsString()
  @IsNotEmpty()
  vehicleDescription: string;

  @IsMongoId()
  @IsNotEmpty()
  vehicleNo: string;

  @IsMongoId()
  @IsNotEmpty()
  vehicle: string;

  @IsMongoId()
  @IsNotEmpty()
  driver: string;

  @IsBoolean()
  @IsOptional()
  status?: string;
}
