import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  Matches,
  Length,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from 'src/comman/pagination.dto';

export class CreateDriverDto {
  @IsNotEmpty()
  @IsString()
  @Length(2, 100)
  @Transform(({ value }) => value?.trim())
  name: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Contact number must be a valid 10-digit Indian mobile number',
  })
  contactNo: string;

  @IsNotEmpty()
  @IsEmail()
  @Transform(({ value }) => value?.toLowerCase().trim())
  email: string;

  @IsNotEmpty()
  @IsString()
  @Length(5, 50)
  @Transform(({ value }) => value?.trim())
  licenseNo: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{12}$/, { message: 'Aadhaar number must be exactly 12 digits' })
  adharNo: string;
}

export class UpdateDriverDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  @Transform(({ value }) => value?.trim())
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Contact number must be a valid 10-digit Indian mobile number',
  })
  contactNo?: string;

  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => value?.toLowerCase().trim())
  email?: string;

  @IsOptional()
  @IsString()
  @Length(5, 50)
  @Transform(({ value }) => value?.trim())
  licenseNo?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{12}$/, { message: 'Aadhaar number must be exactly 12 digits' })
  adharNo?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SearchDriverDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  searchText?: string;
}
