import {
  IsString,
  IsEnum,
  IsNumber,
  IsNotEmpty,
  IsIP,
  IsPort,
  IsOptional,
} from 'class-validator';
import { DeviceType, DeviceStatus } from '../schema/device.schema';

export class CreateDeviceDto {
  @IsString()
  @IsOptional()
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  modelName: string;

  @IsEnum(DeviceType)
  deviceType: DeviceType;

  @IsString()
  @IsNotEmpty()
  manufacturerName: string;

  @IsIP()
  ipAddress: string;

  @IsNumber()
  @IsPort()
  port: number;

  @IsEnum(DeviceStatus)
  status: DeviceStatus;
}
