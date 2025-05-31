import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Res,
} from '@nestjs/common';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleService } from './vechile.service';
import { ApiResponse } from 'src/comman/api-response';
import { PaginationDto } from 'src/comman/pagination.dto';
import { SearchVehicleDto } from './dto/search-vechile.dto';
import { Response } from 'express';

@Controller('vehicles')
export class VehicleController {
  constructor(private readonly vehicleService: VehicleService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createVehicleDto: CreateVehicleDto,
  ): Promise<ApiResponse> {
    try {
      const vehicle = await this.vehicleService.create(createVehicleDto);
      return ApiResponse.success(
        vehicle,
        'Vehicle created successfully',
        HttpStatus.CREATED,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to create vehicle');
    }
  }

  @Get()
  async findAll(
    @Query() paginationDto: PaginationDto,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<ApiResponse> {
    try {
      const include = includeInactive === 'true';
      const result = await this.vehicleService.findAll(paginationDto, include);
      return ApiResponse.success(result, 'Vehicles retrieved successfully');
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch vehicles');
    }
  }

  @Get('export')
  async exportVehicles(
    @Query('format') format: 'pdf' | 'xlsx' | 'csv',
    @Res() res: Response,
  ): Promise<any> {
    try {
      if (!format || !['pdf', 'xlsx', 'csv'].includes(format)) {
        return res
          .status(HttpStatus.BAD_REQUEST)
          .json({ message: 'Invalid format. Use pdf, xlsx, or csv' });
      }

      const vehicles = await this.vehicleService.findAllWithoutPagination();

      switch (format) {
        case 'csv':
          return this.vehicleService.exportToCSV(vehicles, res);
        case 'xlsx':
          return this.vehicleService.exportToXLSX(vehicles, res);
        case 'pdf':
          return this.vehicleService.exportToPDF(vehicles, res);
        default:
          return res
            .status(HttpStatus.BAD_REQUEST)
            .json({ message: 'Invalid format' });
      }
    } catch (error) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to export vehicles',
        error: error.message,
      });
    }
  }

  @Get('search')
  async search(@Query() searchDto: SearchVehicleDto): Promise<ApiResponse> {
    try {
      const result = await this.vehicleService.search(searchDto);
      const message = searchDto.searchText
        ? `Search results for "${searchDto.searchText}" retrieved successfully`
        : 'All vehicles retrieved successfully';
      return ApiResponse.success(result, message);
    } catch (error) {
      throw new InternalServerErrorException('Failed to search vehicles');
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    try {
      if (!id || id.trim() === '') {
        throw new BadRequestException('Vehicle ID is required');
      }
      const vehicle = await this.vehicleService.findOne(id);
      return ApiResponse.success(vehicle, 'Vehicle retrieved successfully');
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to fetch vehicle');
    }
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateVehicleDto: UpdateVehicleDto,
  ): Promise<ApiResponse> {
    try {
      if (!id || id.trim() === '') {
        throw new BadRequestException('Vehicle ID is required');
      }

      if (Object.keys(updateVehicleDto).length === 0) {
        throw new BadRequestException(
          'At least one field is required for update',
        );
      }

      const vehicle = await this.vehicleService.update(id, updateVehicleDto);
      return ApiResponse.success(vehicle, 'Vehicle updated successfully');
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to update vehicle');
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string): Promise<ApiResponse> {
    try {
      if (!id || id.trim() === '') {
        throw new BadRequestException('Vehicle ID is required');
      }
      await this.vehicleService.delete(id);
      return ApiResponse.success(null, 'Vehicle deleted successfully');
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete vehicle');
    }
  }
}
