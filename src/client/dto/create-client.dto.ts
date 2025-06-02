import {
  IsString,
  IsEmail,
  IsOptional,
  IsNotEmpty,
  Length,
  Matches,
} from 'class-validator';
import { PaginationDto } from 'src/comman/pagination.dto';

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  contactName: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Contact number must be a valid 10-digit Indian mobile number',
  })
  contactNo: string;

  @IsString()
  @IsNotEmpty()
  @Length(10, 10)
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, {
    message: 'PAN number must be in valid format (e.g., ABCDE1234F)',
  })
  panNumber: string;

  @IsString()
  @IsNotEmpty()
  @Length(12, 12)
  @Matches(/^\d{12}$/, { message: 'Aadhar number must be 12 digits' })
  aadharNumber: string;

  @IsString()
  @IsNotEmpty()
  @Length(15, 15)
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/, {
    message: 'GST number must be in valid format',
  })
  gstNumber: string;

  @IsString()
  @IsNotEmpty()
  stateName: string;

  @IsString()
  @IsNotEmpty()
  cityName: string;

  @IsString()
  @IsOptional()
  remark?: string;

  @IsString()
  @IsOptional()
  status: string;
}

export class UpdateClientDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  contactName?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Contact number must be a valid 10-digit Indian mobile number',
  })
  contactNo?: string;

  @IsString()
  @IsOptional()
  @Length(10, 10)
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, {
    message: 'PAN number must be in valid format (e.g., ABCDE1234F)',
  })
  panNumber?: string;

  @IsString()
  @IsOptional()
  @Length(12, 12)
  @Matches(/^\d{12}$/, { message: 'Aadhar number must be 12 digits' })
  aadharNumber?: string;

  @IsString()
  @IsOptional()
  @Length(15, 15)
  @Matches(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/, {
    message: 'GST number must be in valid format',
  })
  gstNumber?: string;

  @IsString()
  @IsOptional()
  stateName?: string;

  @IsString()
  @IsOptional()
  cityName?: string;

  @IsString()
  @IsOptional()
  remark?: string;
}
export class SearchClientDto extends PaginationDto {
  @IsString()
  @IsOptional()
  searchText?: string;
}
