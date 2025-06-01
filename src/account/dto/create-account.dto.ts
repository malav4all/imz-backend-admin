// account.dto.ts
import { IsString, IsMongoId, IsOptional, IsNotEmpty } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  accountName: string;

  @IsMongoId()
  @IsOptional()
  parentAccount?: string;

  @IsMongoId()
  @IsNotEmpty()
  clientId: string;
}

// export class UpdateAccountDto {
//   @IsString()
//   @IsOptional()
//   accountName?: string;
// }
