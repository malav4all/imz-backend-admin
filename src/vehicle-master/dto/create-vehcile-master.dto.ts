import { IsString, IsOptional, IsMongoId } from 'class-validator';

export class CreateVehicleMasterDto {
  @IsString()
  vehicleNumber: string;

  @IsString()
  chassisNumber: string;

  @IsString()
  engineNumber: string;

  @IsMongoId()
  vehicleModule: string;

  @IsMongoId()
  driverModule: string;

  @IsOptional()
  status?: string;
}
