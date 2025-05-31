import { IsString, IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { VehicleType } from '../schema/vehicle.schema';

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsBoolean()
  status?: boolean;
}
