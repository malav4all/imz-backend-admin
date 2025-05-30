import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DeviceDocument = Device & Document;

export enum DeviceType {
  IOT = 'iot',
  LOCK = 'lock',
  TRACKER = 'tracker',
}

export enum DeviceStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Schema({ timestamps: true })
export class Device {
  @Prop({ required: false, unique: true })
  deviceId: string;

  @Prop({ required: true })
  modelName: string;

  @Prop({ required: true, enum: DeviceType })
  deviceType: DeviceType;

  @Prop({ required: true })
  manufacturerName: string;

  @Prop({ required: true })
  ipAddress: string;

  @Prop({ required: true })
  port: number;

  @Prop({ required: true, enum: DeviceStatus, default: DeviceStatus.INACTIVE })
  status: DeviceStatus;
}

export const DeviceSchema = SchemaFactory.createForClass(Device);
