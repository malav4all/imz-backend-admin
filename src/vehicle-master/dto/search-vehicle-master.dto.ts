import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from 'src/comman/pagination.dto';

export class SearchVehicleMasterDto extends PaginationDto {
  @IsOptional()
  @IsString()
  searchText?: string;
}
