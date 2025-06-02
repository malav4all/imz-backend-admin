import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DeviceOnboardingDocument = DeviceOnboarding & Document;

@Schema({ timestamps: true })
export class DeviceOnboarding {
  @Prop({ type: Types.ObjectId, ref: 'Account', required: true })
  account: Types.ObjectId;

  @Prop({ required: true, unique: true })
  deviceIMEI: string;

  @Prop({ required: true, unique: true })
  deviceSerialNo: string;

  @Prop({ required: true })
  simNo1: string;

  @Prop()
  simNo2: string;

  @Prop({ required: true })
  simNo1Operator: string;

  @Prop()
  simNo2Operator: string;

  @Prop({ required: true })
  vehicleDescription: string;

  @Prop({ type: Types.ObjectId, ref: 'Vehcile', required: false })
  vehcileNo: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'vehiclemasters', required: false })
  vehicle: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Driver', required: false })
  driver: Types.ObjectId;

  @Prop()
  status: string;
}

export const DeviceOnboardingSchema =
  SchemaFactory.createForClass(DeviceOnboarding);
