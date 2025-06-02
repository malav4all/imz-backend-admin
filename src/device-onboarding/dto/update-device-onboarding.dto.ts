import { PartialType } from '@nestjs/mapped-types';
import { CreateDeviceOnboardingDto } from './create-device-onboarding.dto';

export class UpdateDeviceOnboardingDto extends PartialType(
  CreateDeviceOnboardingDto,
) {}
