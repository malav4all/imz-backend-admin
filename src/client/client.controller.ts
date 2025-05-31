import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { ClientService } from './client.service';
import {
  CreateClientDto,
  SearchClientDto,
  UpdateClientDto,
} from './dto/create-client.dto';
import { ApiResponse } from 'src/comman/api-response';
import { PaginatedResponse } from 'src/comman/pagination.dto';
import { Client } from './schema/client.schema';
import { Response } from 'express';

@Controller('clients')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Post()
  async create(@Body() createClientDto: CreateClientDto) {
    try {
      const client = await this.clientService.create(createClientDto);
      return ApiResponse.success(
        client,
        'Client created successfully',
        HttpStatus.CREATED,
      );
    } catch (error) {
      return ApiResponse.error(
        'Failed to create client',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get()
  async findAll(@Query() searchDto: SearchClientDto) {
    try {
      const result = await this.clientService.findAll(searchDto);
      return ApiResponse.success<PaginatedResponse<Client>>(
        result,
        'Clients retrieved successfully',
      );
    } catch (error) {
      return ApiResponse.error(
        'Failed to retrieve clients',
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('search')
  async search(@Query() searchDto: SearchClientDto) {
    try {
      const result = await this.clientService.findAll(searchDto);
      return ApiResponse.success<PaginatedResponse<Client>>(
        result,
        'Search completed successfully',
      );
    } catch (error) {
      return ApiResponse.error(
        'Search failed',
        error.message,
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('export')
  async exportClients(
    @Query('format') format: 'pdf' | 'xlsx' | 'csv',
    @Res() res: Response,
  ): Promise<any> {
    try {
      const clients = await this.clientService.findAllWithoutPagination();

      switch (format) {
        case 'csv':
          return this.clientService.exportToCSV(clients, res);
        case 'xlsx':
          return this.clientService.exportToXLSX(clients, res);
        case 'pdf':
          return this.clientService.exportToPDF(clients, res);
        default:
          return res
            .status(HttpStatus.BAD_REQUEST)
            .json({ message: 'Invalid format. Use pdf, xlsx, or csv' });
      }
    } catch (error) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to export clients',
        error: error.message,
      });
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const client = await this.clientService.findOne(id);
      return ApiResponse.success(client, 'Client retrieved successfully');
    } catch (error) {
      return ApiResponse.error(
        'Failed to retrieve client',
        error.message,
        error.status || HttpStatus.NOT_FOUND,
      );
    }
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
  ) {
    try {
      const client = await this.clientService.update(id, updateClientDto);
      return ApiResponse.success(client, 'Client updated successfully');
    } catch (error) {
      return ApiResponse.error(
        'Failed to update client',
        error.message,
        error.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.clientService.remove(id);
      return ApiResponse.success(null, 'Client deleted successfully');
    } catch (error) {
      return ApiResponse.error(
        'Failed to delete client',
        error.message,
        error.status || HttpStatus.NOT_FOUND,
      );
    }
  }
}
