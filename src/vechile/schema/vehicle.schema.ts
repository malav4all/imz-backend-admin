import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type VehicleDocument = Vehicle & Document;

export enum VehicleType {
  CAR = 'car',
  MOTORCYCLE = 'motorcycle',
  TRUCK = 'truck',
  BUS = 'bus',
  VAN = 'van',
  SUV = 'suv',
}

@Schema({ timestamps: true })
export class Vehicle {
  @Prop({ required: true, trim: true })
  brandName: string;

  @Prop({ required: true, trim: true })
  modelName: string;

  @Prop({ required: true, enum: VehicleType })
  vehicleType: VehicleType;

  @Prop({ required: false })
  icon: string;

  @Prop({ default: 'active' })
  status: string;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const VehicleSchema = SchemaFactory.createForClass(Vehicle);
