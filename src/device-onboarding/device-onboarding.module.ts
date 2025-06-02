import { Module } from '@nestjs/common';
import { DeviceOnboardingService } from './device-onboarding.service';
import { DeviceOnboardingController } from './device-onboarding.controller';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DeviceOnboarding,
  DeviceOnboardingSchema,
} from './schema/device-onboarding.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeviceOnboarding.name, schema: DeviceOnboardingSchema },
    ]),
  ],
  providers: [DeviceOnboardingService],
  controllers: [DeviceOnboardingController],
  exports: [DeviceOnboardingService],
})
export class DeviceOnboardingModule {}
