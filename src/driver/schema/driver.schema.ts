import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DriverDocument = Driver & Document;

@Schema({
  timestamps: true,
  collection: 'drivers',
})
export class Driver {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  contactNo: string;

  @Prop({ required: true, trim: true, lowercase: true })
  email: string;

  @Prop({ required: true, trim: true, unique: true })
  licenseNo: string;

  @Prop({ required: true, trim: true, unique: true })
  adharNo: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const DriverSchema = SchemaFactory.createForClass(Driver);

// Create indexes for better search performance
DriverSchema.index({ name: 'text', email: 'text', contactNo: 'text' });
DriverSchema.index({ licenseNo: 1 });
DriverSchema.index({ adharNo: 1 });
