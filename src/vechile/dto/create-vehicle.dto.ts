import { IsString, IsEnum, IsOptional, IsNotEmpty } from 'class-validator';
import { VehicleType } from '../schema/vehicle.schema';

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  brandName: string;

  @IsString()
  @IsNotEmpty()
  modelName: string;

  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
