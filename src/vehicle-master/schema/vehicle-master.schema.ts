import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type VehicleMasterDocument = VehicleMaster & Document;

@Schema({ timestamps: true })
export class VehicleMaster {
  @Prop({ required: true, unique: true })
  vehicleNumber: string;

  @Prop({ required: true, unique: true })
  chassisNumber: string;

  @Prop({ required: true, unique: true })
  engineNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'Vehicle', required: true })
  vehicleModule: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Driver', required: true })
  driverModule: Types.ObjectId;

  @Prop({})
  status: string;
}

export const VehicleMasterSchema = SchemaFactory.createForClass(VehicleMaster);
