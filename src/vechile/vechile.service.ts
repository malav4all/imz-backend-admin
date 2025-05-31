// vehicle.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { Vehicle, VehicleDocument } from './schema/vehicle.schema';
import { PaginatedResponse, PaginationDto } from 'src/comman/pagination.dto';
import { SearchVehicleDto } from './dto/search-vechile.dto';
import * as PDFDocument from 'pdfkit';
import * as ExcelJS from 'exceljs';
import { format } from '@fast-csv/format';
import { Response } from 'express';
import axios from 'axios';

@Injectable()
export class VehicleService {
  private readonly logger = new Logger(VehicleService.name);
  private readonly logsServiceUrl =
    process.env.LOGS_SERVICE_URL || 'http://localhost:9008/logs';

  constructor(
    @InjectModel(Vehicle.name) private vehicleModel: Model<VehicleDocument>,
  ) {}

  async create(
    createVehicleDto: CreateVehicleDto,
    userId?: string,
  ): Promise<Vehicle> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Creating vehicle: ${createVehicleDto.brandName} ${createVehicleDto.modelName}`,
      );

      const vehicle = new this.vehicleModel(createVehicleDto);
      const savedVehicle = await vehicle.save();

      // 📝 Log successful creation (only success log)
      await this.sendLog({
        method: 'POST',
        url: '/api/vehicles',
        statusCode: 201,
        operation: 'CREATE',
        resource: 'VEHICLE',
        message: `Vehicle created successfully: ${savedVehicle.brandName} ${savedVehicle.modelName}`,
        userId,
        metadata: {
          vehicleId: savedVehicle._id,
          brandName: savedVehicle.brandName,
          modelName: savedVehicle.modelName,
          vehicleType: savedVehicle.vehicleType,
          requestData: createVehicleDto,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(
        `Vehicle created successfully with ID: ${savedVehicle._id}`,
      );
      return savedVehicle;
    } catch (error) {
      let errorMessage = 'Failed to create vehicle';
      let statusCode = 500;

      if (error.code === 11000) {
        errorMessage = 'Vehicle with this combination already exists';
        statusCode = 409;

        // 📝 Log duplicate error (only error log)
        await this.sendLog({
          method: 'POST',
          url: '/api/vehicles',
          statusCode: 409,
          operation: 'CREATE',
          resource: 'VEHICLE',
          message: 'Vehicle creation failed - duplicate combination',
          userId,
          metadata: {
            requestData: createVehicleDto,
            errorType: 'DUPLICATE_ENTRY',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new BadRequestException(errorMessage);
      }

      // 📝 Log other errors (only error log)
      await this.sendLog({
        method: 'POST',
        url: '/api/vehicles',
        statusCode: 500,
        operation: 'CREATE',
        resource: 'VEHICLE',
        message: `Vehicle creation failed: ${error.message}`,
        userId,
        metadata: {
          requestData: createVehicleDto,
          errorType: error.name,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to create vehicle: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(errorMessage);
    }
  }

  async findAll(
    paginationDto: PaginationDto,
    includeInactive: boolean = false,
    userId?: string,
  ): Promise<PaginatedResponse<Vehicle>> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Retrieving vehicles - Page: ${paginationDto.page}, Limit: ${paginationDto.limit}`,
      );

      const { page = 1, limit = 10 } = paginationDto;
      const skip = (page - 1) * limit;

      const [vehicles, total] = await Promise.all([
        this.vehicleModel
          .find()
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 })
          .exec(),
        this.vehicleModel.countDocuments(),
      ]);

      const result = new PaginatedResponse(vehicles, page, limit, total);

      // 📝 Log successful retrieval (only success log)
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicles',
        statusCode: 200,
        operation: 'READ',
        resource: 'VEHICLE',
        message: `Successfully retrieved ${vehicles.length} vehicles`,
        userId,
        metadata: {
          page,
          limit,
          includeInactive,
          retrievedCount: vehicles.length,
          totalCount: total,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(
        `Retrieved ${vehicles.length} vehicles out of ${total} total`,
      );
      return result;
    } catch (error) {
      // 📝 Log error (only error log)
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicles',
        statusCode: 500,
        operation: 'READ',
        resource: 'VEHICLE',
        message: `Failed to retrieve vehicles: ${error.message}`,
        userId,
        metadata: {
          page: paginationDto.page,
          limit: paginationDto.limit,
          includeInactive,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to fetch vehicles: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to fetch vehicles');
    }
  }

  async findAllWithoutPagination(userId?: string): Promise<Vehicle[]> {
    const startTime = Date.now();

    try {
      this.logger.log('Retrieving all vehicles without pagination');

      const vehicles = await this.vehicleModel.find().exec();

      // 📝 Log successful retrieval (only success log)
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicles/all',
        statusCode: 200,
        operation: 'READ',
        resource: 'VEHICLE',
        message: `Retrieved all ${vehicles.length} vehicles`,
        userId,
        metadata: { totalCount: vehicles.length },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`Retrieved all ${vehicles.length} vehicles`);
      return vehicles;
    } catch (error) {
      // 📝 Log error (only error log)
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicles/all',
        statusCode: 500,
        operation: 'READ',
        resource: 'VEHICLE',
        message: `Failed to retrieve all vehicles: ${error.message}`,
        userId,
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to fetch vehicles: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to fetch vehicles');
    }
  }

  async findOne(id: string, userId?: string): Promise<Vehicle> {
    const startTime = Date.now();

    try {
      this.logger.log(`Finding vehicle with ID: ${id}`);

      const vehicle = await this.vehicleModel.findById(id).exec();

      if (!vehicle) {
        this.logger.warn(`Vehicle not found with ID: ${id}`);

        // 📝 Log not found (only not found log)
        await this.sendLog({
          method: 'GET',
          url: `/api/vehicles/${id}`,
          statusCode: 404,
          operation: 'READ',
          resource: 'VEHICLE',
          message: `Vehicle not found with ID: ${id}`,
          userId,
          metadata: { vehicleId: id },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException(`Vehicle with ID ${id} not found`);
      }

      // 📝 Log successful find (only success log)
      await this.sendLog({
        method: 'GET',
        url: `/api/vehicles/${id}`,
        statusCode: 200,
        operation: 'READ',
        resource: 'VEHICLE',
        message: `Vehicle found successfully`,
        userId,
        metadata: {
          vehicleId: id,
          foundVehicleId: vehicle._id,
          brandName: vehicle.brandName,
          modelName: vehicle.modelName,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`Vehicle found with ID: ${id}`);
      return vehicle;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      // 📝 Log error (only error log)
      await this.sendLog({
        method: 'GET',
        url: `/api/vehicles/${id}`,
        statusCode: 500,
        operation: 'READ',
        resource: 'VEHICLE',
        message: `Failed to find vehicle: ${error.message}`,
        userId,
        metadata: { vehicleId: id },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to fetch vehicle: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to fetch vehicle');
    }
  }

  async update(
    id: string,
    updateVehicleDto: UpdateVehicleDto,
    userId?: string,
  ): Promise<Vehicle> {
    const startTime = Date.now();

    try {
      this.logger.log(`Updating vehicle with ID: ${id}`);

      const vehicle = await this.vehicleModel
        .findByIdAndUpdate(
          id,
          { ...updateVehicleDto, updatedAt: new Date() },
          { new: true },
        )
        .exec();

      if (!vehicle) {
        this.logger.warn(`Vehicle not found for update with ID: ${id}`);

        // 📝 Log not found (only not found log)
        await this.sendLog({
          method: 'PUT',
          url: `/api/vehicles/${id}`,
          statusCode: 404,
          operation: 'UPDATE',
          resource: 'VEHICLE',
          message: `Vehicle not found for update with ID: ${id}`,
          userId,
          metadata: {
            vehicleId: id,
            updateData: updateVehicleDto,
          },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException(`Vehicle with ID ${id} not found`);
      }

      // 📝 Log successful update (only success log)
      await this.sendLog({
        method: 'PUT',
        url: `/api/vehicles/${id}`,
        statusCode: 200,
        operation: 'UPDATE',
        resource: 'VEHICLE',
        message: `Vehicle updated successfully: ${vehicle.brandName} ${vehicle.modelName}`,
        userId,
        metadata: {
          vehicleId: id,
          updatedVehicleId: vehicle._id,
          brandName: vehicle.brandName,
          modelName: vehicle.modelName,
          updateData: updateVehicleDto,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`Vehicle updated successfully with ID: ${id}`);
      return vehicle;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      let errorMessage = 'Failed to update vehicle';
      let statusCode = 500;

      if (error.code === 11000) {
        errorMessage = 'Vehicle with this combination already exists';
        statusCode = 409;

        // 📝 Log duplicate error (only error log)
        await this.sendLog({
          method: 'PUT',
          url: `/api/vehicles/${id}`,
          statusCode: 409,
          operation: 'UPDATE',
          resource: 'VEHICLE',
          message: 'Vehicle update failed - duplicate combination',
          userId,
          metadata: {
            vehicleId: id,
            updateData: updateVehicleDto,
            errorType: 'DUPLICATE_ENTRY',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
        });

        throw new BadRequestException(errorMessage);
      }

      // 📝 Log other errors (only error log)
      await this.sendLog({
        method: 'PUT',
        url: `/api/vehicles/${id}`,
        statusCode: 500,
        operation: 'UPDATE',
        resource: 'VEHICLE',
        message: `Vehicle update failed: ${error.message}`,
        userId,
        metadata: {
          vehicleId: id,
          updateData: updateVehicleDto,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to update vehicle: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(errorMessage);
    }
  }

  async delete(id: string, userId?: string): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(`Deleting vehicle with ID: ${id}`);

      const result = await this.vehicleModel.findByIdAndDelete(id).exec();

      if (!result) {
        this.logger.warn(`Vehicle not found for deletion with ID: ${id}`);

        // 📝 Log not found (only not found log)
        await this.sendLog({
          method: 'DELETE',
          url: `/api/vehicles/${id}`,
          statusCode: 404,
          operation: 'DELETE',
          resource: 'VEHICLE',
          message: `Vehicle not found for deletion with ID: ${id}`,
          userId,
          metadata: { vehicleId: id },
          responseTime: Date.now() - startTime,
        });

        throw new NotFoundException(`Vehicle with ID ${id} not found`);
      }

      // 📝 Log successful deletion (only success log)
      await this.sendLog({
        method: 'DELETE',
        url: `/api/vehicles/${id}`,
        statusCode: 200,
        operation: 'DELETE',
        resource: 'VEHICLE',
        message: `Vehicle deleted successfully: ${result.brandName} ${result.modelName}`,
        userId,
        metadata: {
          vehicleId: id,
          deletedVehicleId: result._id,
          brandName: result.brandName,
          modelName: result.modelName,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`Vehicle deleted successfully with ID: ${id}`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      // 📝 Log error (only error log)
      await this.sendLog({
        method: 'DELETE',
        url: `/api/vehicles/${id}`,
        statusCode: 500,
        operation: 'DELETE',
        resource: 'VEHICLE',
        message: `Vehicle deletion failed: ${error.message}`,
        userId,
        metadata: { vehicleId: id },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to delete vehicle: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to delete vehicle');
    }
  }

  async search(
    searchDto: SearchVehicleDto,
    userId?: string,
  ): Promise<PaginatedResponse<Vehicle>> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Searching vehicles with text: "${searchDto.searchText}"`,
      );

      const { searchText, page = 1, limit = 10 } = searchDto;
      const skip = (page - 1) * limit;

      // Base filter for status
      let baseFilter: any = {};

      // If no search text provided, return all vehicles with pagination
      if (!searchText || searchText.trim() === '') {
        const [vehicles, total] = await Promise.all([
          this.vehicleModel
            .find(baseFilter)
            .skip(skip)
            .limit(limit)
            .sort({ createdAt: -1 })
            .exec(),
          this.vehicleModel.countDocuments(baseFilter),
        ]);

        const result = new PaginatedResponse(vehicles, page, limit, total);

        // 📝 Log successful search (only success log)
        await this.sendLog({
          method: 'GET',
          url: '/api/vehicles/search',
          statusCode: 200,
          operation: 'SEARCH',
          resource: 'VEHICLE',
          message: `Vehicle search completed - found ${vehicles.length} vehicles (no search text)`,
          userId,
          metadata: {
            searchText: '',
            page,
            limit,
            foundCount: vehicles.length,
            totalCount: total,
          },
          responseTime: Date.now() - startTime,
        });

        return result;
      }

      // Create search regex for case-insensitive partial matching
      const searchRegex = new RegExp(searchText.trim(), 'i');

      // Search across all text fields
      const searchFilter = {
        ...baseFilter,
        $or: [
          { brandName: { $regex: searchRegex } },
          { modelName: { $regex: searchRegex } },
          { vehicleType: { $regex: searchRegex } },
          { icon: { $regex: searchRegex } },
        ],
      };

      const [vehicles, total] = await Promise.all([
        this.vehicleModel
          .find(searchFilter)
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 })
          .exec(),
        this.vehicleModel.countDocuments(searchFilter),
      ]);

      const result = new PaginatedResponse(vehicles, page, limit, total);

      // 📝 Log successful search (only success log)
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicles/search',
        statusCode: 200,
        operation: 'SEARCH',
        resource: 'VEHICLE',
        message: `Vehicle search completed - found ${vehicles.length} vehicles`,
        userId,
        metadata: {
          searchText,
          page,
          limit,
          foundCount: vehicles.length,
          totalCount: total,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(
        `Vehicle search completed - found ${vehicles.length} vehicles`,
      );
      return result;
    } catch (error) {
      // 📝 Log search error (only error log)
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicles/search',
        statusCode: 500,
        operation: 'SEARCH',
        resource: 'VEHICLE',
        message: `Vehicle search failed: ${error.message}`,
        userId,
        metadata: {
          searchText: searchDto.searchText,
          page: searchDto.page,
          limit: searchDto.limit,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(
        `Failed to search vehicles: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to search vehicles');
    }
  }

  exportToPDF(vehicles: Vehicle[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting PDF export for ${vehicles.length} vehicles`);

      // Create a document with margins
      const doc = new PDFDocument({ margin: 30 });

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=vehicles.pdf');

      doc.pipe(res);

      // Title
      doc.fontSize(18).text('Vehicle List', { align: 'center' }).moveDown(1);

      // Define table structure
      const table = {
        headers: [
          { label: 'Brand Name', width: 120 },
          { label: 'Model Name', width: 120 },
          { label: 'Type', width: 100 },
          { label: 'Icon', width: 120 },
          { label: 'Status', width: 80 },
        ],
        rows: vehicles.map((vehicle) => [
          vehicle.brandName || '',
          vehicle.modelName || '',
          vehicle.vehicleType || '',
          vehicle.icon || '',
          vehicle.status ? 'Active' : 'Inactive',
        ]),
        rowHeight: 25,
        margin: { top: 40 },
      };

      // Table drawing position
      const startY = doc.y + table.margin.top;
      let currentY = startY;

      // Draw table headers
      doc.font('Helvetica-Bold').fontSize(10);
      let x = doc.page.margins.left;

      table.headers.forEach((header, i) => {
        doc.text(header.label, x, currentY, {
          width: header.width,
          align: 'left',
        });
        x += header.width;
      });

      currentY += table.rowHeight;

      // Draw horizontal line under headers
      doc
        .moveTo(doc.page.margins.left, currentY - 5)
        .lineTo(doc.page.width - doc.page.margins.right, currentY - 5)
        .stroke();

      // Draw table rows
      doc.font('Helvetica').fontSize(10);

      table.rows.forEach((row, rowIndex) => {
        x = doc.page.margins.left;
        let maxHeightInRow = 0;

        // Draw each cell in the row
        row.forEach((cell, colIndex) => {
          const cellHeight = doc.heightOfString(cell, {
            width: table.headers[colIndex].width,
          });

          maxHeightInRow = Math.max(maxHeightInRow, cellHeight);

          doc.text(cell, x, currentY, {
            width: table.headers[colIndex].width,
            align: 'left',
          });

          x += table.headers[colIndex].width;
        });

        currentY += maxHeightInRow + 10;

        // Add a new page if we're at the bottom
        if (currentY > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          currentY = doc.page.margins.top;
        }
      });

      doc.end();

      // 📝 Log export success (only success log)
      this.sendLog({
        method: 'GET',
        url: '/api/vehicles/export/pdf',
        statusCode: 200,
        operation: 'EXPORT',
        resource: 'VEHICLE',
        message: `PDF export completed successfully`,
        userId,
        metadata: {
          exportFormat: 'PDF',
          vehicleCount: vehicles.length,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`PDF export completed for ${vehicles.length} vehicles`);
    } catch (error) {
      // 📝 Log export error (only error log)
      this.sendLog({
        method: 'GET',
        url: '/api/vehicles/export/pdf',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'VEHICLE',
        message: `PDF export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'PDF',
          vehicleCount: vehicles.length,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      this.logger.error(`Failed to export PDF: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to export PDF');
    }
  }

  exportToCSV(vehicles: Vehicle[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting CSV export for ${vehicles.length} vehicles`);

      // Set response headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=vehicles_' +
          new Date().toISOString().slice(0, 10) +
          '.csv',
      );

      // CSV configuration
      const csvStream = format({
        headers: [
          'Brand Name',
          'Model Name',
          'Vehicle Type',
          'Icon',
          'Status',
          'Created At',
          'Updated At',
        ],
        writeHeaders: true,
        delimiter: ',',
        quote: '"',
        escape: '"',
        includeEndRowDelimiter: true,
      });

      // Pipe CSV stream to response
      csvStream.pipe(res);

      // Write data rows
      vehicles.forEach((vehicle) => {
        csvStream.write({
          'Brand Name': vehicle.brandName || 'N/A',
          'Model Name': vehicle.modelName || 'N/A',
          'Vehicle Type': vehicle.vehicleType || 'N/A',
          Icon: vehicle.icon || 'N/A',
          Status: vehicle.status ? 'Active' : 'Inactive',
          'Created At': vehicle.createdAt
            ? vehicle.createdAt.toISOString()
            : 'N/A',
          'Updated At': vehicle.updatedAt
            ? vehicle.updatedAt.toISOString()
            : 'N/A',
        });
      });

      // Handle stream events
      csvStream.on('error', (error) => {
        console.error('CSV stream error:', error);
        // 📝 Log CSV error (only error log)
        this.sendLog({
          method: 'GET',
          url: '/api/vehicles/export/csv',
          statusCode: 500,
          operation: 'EXPORT',
          resource: 'VEHICLE',
          message: `CSV export failed: ${error.message}`,
          userId,
          metadata: {
            exportFormat: 'CSV',
            vehicleCount: vehicles.length,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
        });

        if (!res.headersSent) {
          res.status(500).send('Error generating CSV');
        }
      });

      csvStream.on('end', () => {
        console.log('CSV export completed successfully');
        // 📝 Log export success (only success log)
        this.sendLog({
          method: 'GET',
          url: '/api/vehicles/export/csv',
          statusCode: 200,
          operation: 'EXPORT',
          resource: 'VEHICLE',
          message: `CSV export completed successfully`,
          userId,
          metadata: {
            exportFormat: 'CSV',
            vehicleCount: vehicles.length,
          },
          responseTime: Date.now() - startTime,
        });
      });

      csvStream.end();
    } catch (error) {
      console.error('Error in exportToCSV:', error);
      // 📝 Log export error (only error log)
      this.sendLog({
        method: 'GET',
        url: '/api/vehicles/export/csv',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'VEHICLE',
        message: `CSV export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'CSV',
          vehicleCount: vehicles.length,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      if (!res.headersSent) {
        res.status(500).send('Internal Server Error');
      }
    }
  }

  async exportToXLSX(
    vehicles: Vehicle[],
    res: Response,
    userId?: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting XLSX export for ${vehicles.length} vehicles`);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Vehicle Management System';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Vehicles', {
        pageSetup: {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
        },
      });

      // Define columns with specific widths and styles
      worksheet.columns = [
        { header: 'Brand Name', key: 'brandName', width: 25 },
        { header: 'Model Name', key: 'modelName', width: 25 },
        { header: 'Vehicle Type', key: 'vehicleType', width: 20 },
        { header: 'Icon', key: 'icon', width: 30 },
        { header: 'Status', key: 'status', width: 15 },
        {
          header: 'Created At',
          key: 'createdAt',
          width: 20,
          style: { numFmt: 'yyyy-mm-dd hh:mm:ss' },
        },
        {
          header: 'Updated At',
          key: 'updatedAt',
          width: 20,
          style: { numFmt: 'yyyy-mm-dd hh:mm:ss' },
        },
      ];

      // Add header style
      worksheet.getRow(1).eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF4472C4' }, // Blue background
        };
        cell.font = {
          bold: true,
          color: { argb: 'FFFFFFFF' }, // White text
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true,
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      // Add data rows with conditional formatting
      vehicles.forEach((vehicle) => {
        const row = worksheet.addRow({
          brandName: vehicle.brandName || 'N/A',
          modelName: vehicle.modelName || 'N/A',
          vehicleType: vehicle.vehicleType || 'N/A',
          icon: vehicle.icon || 'N/A',
          status: vehicle.status ? 'Active' : 'Inactive',
          createdAt: vehicle.createdAt,
          updatedAt: vehicle.updatedAt,
        });

        // Style the data rows
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };

          // Highlight active vehicles
          if (cell.value === 'Active') {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFC6EFCE' }, // Light green
            };
          } else if (cell.value === 'Inactive') {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFC7CE' }, // Light red
            };
          }
        });
      });

      // Freeze header row
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];

      // Auto-filter
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: worksheet.columnCount },
      };

      // Set response headers
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=vehicles_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );

      await workbook.xlsx.write(res);
      res.end();

      // 📝 Log export success (only success log)
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicles/export/xlsx',
        statusCode: 200,
        operation: 'EXPORT',
        resource: 'VEHICLE',
        message: `XLSX export completed successfully`,
        userId,
        metadata: {
          exportFormat: 'XLSX',
          vehicleCount: vehicles.length,
        },
        responseTime: Date.now() - startTime,
      });

      this.logger.log(`XLSX export completed for ${vehicles.length} vehicles`);
    } catch (error) {
      console.error('Error exporting to XLSX:', error);

      // 📝 Log export error (only error log)
      await this.sendLog({
        method: 'GET',
        url: '/api/vehicles/export/xlsx',
        statusCode: 500,
        operation: 'EXPORT',
        resource: 'VEHICLE',
        message: `XLSX export failed: ${error.message}`,
        userId,
        metadata: {
          exportFormat: 'XLSX',
          vehicleCount: vehicles.length,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      if (!res.headersSent) {
        res.status(500).send('Error generating Excel file');
      }
    }
  }

  /**
   * Send log to logs microservice using axios
   */
  private async sendLog(logData: {
    method: string;
    url: string;
    statusCode: number;
    operation: string;
    resource: string;
    message: string;
    userId?: string;
    metadata?: any;
    responseTime?: number;
    isError?: boolean;
    errorMessage?: string;
    stackTrace?: string;
  }): Promise<void> {
    try {
      await axios.post(
        this.logsServiceUrl,
        {
          ...logData,
          timestamp: new Date(),
          ipAddress: 'internal',
          userAgent: 'vehicle-service',
        },
        {
          timeout: 5000, // 5 second timeout
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      // Silent fail - don't let logging break main functionality
      this.logger.warn(`Failed to send log to microservice: ${error.message}`);
    }
  }
}
