import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Response } from 'express';
import * as PDFDocument from 'pdfkit';
import { format } from 'fast-csv';
import * as ExcelJS from 'exceljs';
import axios from 'axios';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { GroupQueryDto } from './dto/group-query.dto';
import { Group, GroupDocument } from './schema/group.schema';
import { PaginatedResponse } from 'src/comman/pagination.dto';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);
  private readonly logsServiceUrl =
    process.env.LOGS_SERVICE_URL || 'http://localhost:3001/logs';

  constructor(
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
  ) {}

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
          userAgent: 'groups-service',
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

  async create(
    createGroupDto: CreateGroupDto,
    userId?: string,
  ): Promise<Group> {
    const startTime = Date.now();

    try {
      // Convert string IDs to ObjectIds
      const imeiObjectIds = createGroupDto.imei.map(
        (id) => new Types.ObjectId(id),
      );

      const createdGroup = new this.groupModel({
        ...createGroupDto,
        imei: imeiObjectIds,
      });

      const savedGroup = await createdGroup.save();

      await this.sendLog({
        method: 'POST',
        url: '/groups',
        statusCode: 201,
        operation: 'CREATE_GROUP',
        resource: 'groups',
        message: 'Group created successfully',
        userId,
        metadata: {
          groupId: savedGroup._id,
          groupName: savedGroup.groupName,
          groupType: savedGroup.groupType,
          deviceCount: createGroupDto.imei.length,
          imeiIds: createGroupDto.imei,
        },
        responseTime: Date.now() - startTime,
      });

      return savedGroup;
    } catch (error) {
      let statusCode = 400;
      let errorMessage = error.message;

      if (error.code === 11000) {
        errorMessage = 'Group with this name already exists';
        statusCode = 409;
      }

      await this.sendLog({
        method: 'POST',
        url: '/groups',
        statusCode,
        operation: 'CREATE_GROUP',
        resource: 'groups',
        message: 'Failed to create group',
        userId,
        metadata: {
          groupData: createGroupDto,
          errorCode: error.code,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage,
        stackTrace: error.stack,
      });

      if (error.code === 11000) {
        throw new BadRequestException('Group with this name already exists');
      }
      throw new BadRequestException('Failed to create group: ' + error.message);
    }
  }

  async findAll(
    queryDto: GroupQueryDto,
    userId?: string,
  ): Promise<PaginatedResponse<any>> {
    const startTime = Date.now();

    try {
      const { page = 1, limit = 10, search, ...filters } = queryDto;
      const skip = (page - 1) * limit;

      const filterQuery: any = {};

      // Global search
      if (search && search.trim()) {
        const searchRegex = { $regex: search.trim(), $options: 'i' };
        filterQuery.$or = [
          { groupName: searchRegex },
          { groupType: searchRegex },
          { stateName: searchRegex },
          { cityName: searchRegex },
          { contactNo: searchRegex },
          { remark: searchRegex },
        ];
      }

      // Specific filters
      if (filters.groupName) {
        filterQuery.groupName = { $regex: filters.groupName, $options: 'i' };
      }

      if (filters.groupType) {
        filterQuery.groupType = { $regex: filters.groupType, $options: 'i' };
      }

      if (filters.stateName) {
        filterQuery.stateName = { $regex: filters.stateName, $options: 'i' };
      }

      if (filters.cityName) {
        filterQuery.cityName = { $regex: filters.cityName, $options: 'i' };
      }

      const result = await this.groupModel.aggregate([
        { $match: filterQuery },

        {
          $lookup: {
            from: 'deviceonboardings',
            localField: 'imei',
            foreignField: '_id',
            as: 'imei',
          },
        },

        {
          $facet: {
            data: [
              { $sort: { createdAt: -1 } },
              { $skip: skip },
              { $limit: Number(limit) },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ]);

      const groups = result[0].data;
      const total = result[0].total[0]?.count || 0;
      const paginatedResult = new PaginatedResponse(groups, page, limit, total);

      await this.sendLog({
        method: 'GET',
        url: '/groups',
        statusCode: 200,
        operation: 'LIST_GROUPS',
        resource: 'groups',
        message: 'Groups retrieved successfully',
        userId,
        metadata: {
          page,
          limit,
          total,
          resultCount: groups.length,
          searchTerm: search,
          filters,
          hasFilters: Object.keys(filters).length > 0,
        },
        responseTime: Date.now() - startTime,
      });

      return paginatedResult;
    } catch (error) {
      await this.sendLog({
        method: 'GET',
        url: '/groups',
        statusCode: 400,
        operation: 'LIST_GROUPS',
        resource: 'groups',
        message: 'Failed to fetch groups',
        userId,
        metadata: {
          query: queryDto,
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      throw new BadRequestException('Failed to fetch groups: ' + error.message);
    }
  }

  async findOne(id: string, userId?: string): Promise<Group> {
    const startTime = Date.now();

    try {
      if (!Types.ObjectId.isValid(id)) {
        await this.sendLog({
          method: 'GET',
          url: `/groups/${id}`,
          statusCode: 400,
          operation: 'GET_GROUP',
          resource: 'groups',
          message: 'Invalid group ID format',
          userId,
          metadata: { groupId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid group ID format',
        });

        throw new BadRequestException('Invalid group ID format');
      }

      const group = await this.groupModel
        .findById(id)
        .populate('imei', 'deviceId serialNumber')
        .exec();

      if (!group) {
        await this.sendLog({
          method: 'GET',
          url: `/groups/${id}`,
          statusCode: 404,
          operation: 'GET_GROUP',
          resource: 'groups',
          message: 'Group not found',
          userId,
          metadata: { groupId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: `Group with ID ${id} not found`,
        });

        throw new NotFoundException(`Group with ID ${id} not found`);
      }

      await this.sendLog({
        method: 'GET',
        url: `/groups/${id}`,
        statusCode: 200,
        operation: 'GET_GROUP',
        resource: 'groups',
        message: 'Group retrieved successfully',
        userId,
        metadata: {
          groupId: id,
          groupName: group.groupName,
          groupType: group.groupType,
          deviceCount: group.imei?.length || 0,
        },
        responseTime: Date.now() - startTime,
      });

      return group;
    } catch (error) {
      if (
        !(error instanceof NotFoundException) &&
        !(error instanceof BadRequestException)
      ) {
        await this.sendLog({
          method: 'GET',
          url: `/groups/${id}`,
          statusCode: 400,
          operation: 'GET_GROUP',
          resource: 'groups',
          message: 'Unexpected error while fetching group',
          userId,
          metadata: { groupId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });

        throw new BadRequestException(
          'Failed to fetch group: ' + error.message,
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    updateGroupDto: UpdateGroupDto,
    userId?: string,
  ): Promise<Group> {
    const startTime = Date.now();

    try {
      if (!Types.ObjectId.isValid(id)) {
        await this.sendLog({
          method: 'PATCH',
          url: `/groups/${id}`,
          statusCode: 400,
          operation: 'UPDATE_GROUP',
          resource: 'groups',
          message: 'Invalid group ID format',
          userId,
          metadata: { groupId: id, updateData: updateGroupDto },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid group ID format',
        });

        throw new BadRequestException('Invalid group ID format');
      }

      const updateData: any = { ...updateGroupDto };

      // Convert imei string IDs to ObjectIds if provided
      if (updateGroupDto.imei) {
        updateData.imei = updateGroupDto.imei.map(
          (id) => new Types.ObjectId(id),
        );
      }

      const updatedGroup = await this.groupModel
        .findByIdAndUpdate(id, updateData, {
          new: true,
          runValidators: true,
        })
        .populate('imei', 'deviceId serialNumber')
        .exec();

      if (!updatedGroup) {
        await this.sendLog({
          method: 'PATCH',
          url: `/groups/${id}`,
          statusCode: 404,
          operation: 'UPDATE_GROUP',
          resource: 'groups',
          message: 'Group not found for update',
          userId,
          metadata: { groupId: id, updateData: updateGroupDto },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: `Group with ID ${id} not found`,
        });

        throw new NotFoundException(`Group with ID ${id} not found`);
      }

      await this.sendLog({
        method: 'PATCH',
        url: `/groups/${id}`,
        statusCode: 200,
        operation: 'UPDATE_GROUP',
        resource: 'groups',
        message: 'Group updated successfully',
        userId,
        metadata: {
          groupId: id,
          groupName: updatedGroup.groupName,
          updateData: updateGroupDto,
          previousDeviceCount: updateGroupDto.imei ? 'changed' : 'unchanged',
          newDeviceCount: updatedGroup.imei?.length || 0,
        },
        responseTime: Date.now() - startTime,
      });

      return updatedGroup;
    } catch (error) {
      if (
        !(error instanceof NotFoundException) &&
        !(error instanceof BadRequestException)
      ) {
        let statusCode = 400;
        let errorMessage = error.message;

        if (error.code === 11000) {
          statusCode = 409;
          errorMessage = 'Group with this name already exists';
        }

        await this.sendLog({
          method: 'PATCH',
          url: `/groups/${id}`,
          statusCode,
          operation: 'UPDATE_GROUP',
          resource: 'groups',
          message: 'Failed to update group',
          userId,
          metadata: {
            groupId: id,
            updateData: updateGroupDto,
            errorCode: error.code,
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage,
          stackTrace: error.stack,
        });

        if (error.code === 11000) {
          throw new BadRequestException('Group with this name already exists');
        }
        throw new BadRequestException(
          'Failed to update group: ' + error.message,
        );
      }
      throw error;
    }
  }

  async remove(id: string, userId?: string): Promise<void> {
    const startTime = Date.now();

    try {
      if (!Types.ObjectId.isValid(id)) {
        await this.sendLog({
          method: 'DELETE',
          url: `/groups/${id}`,
          statusCode: 400,
          operation: 'DELETE_GROUP',
          resource: 'groups',
          message: 'Invalid group ID format',
          userId,
          metadata: { groupId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: 'Invalid group ID format',
        });

        throw new BadRequestException('Invalid group ID format');
      }

      const result = await this.groupModel.findByIdAndDelete(id).exec();

      if (!result) {
        await this.sendLog({
          method: 'DELETE',
          url: `/groups/${id}`,
          statusCode: 404,
          operation: 'DELETE_GROUP',
          resource: 'groups',
          message: 'Group not found for deletion',
          userId,
          metadata: { groupId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: `Group with ID ${id} not found`,
        });

        throw new NotFoundException(`Group with ID ${id} not found`);
      }

      await this.sendLog({
        method: 'DELETE',
        url: `/groups/${id}`,
        statusCode: 200,
        operation: 'DELETE_GROUP',
        resource: 'groups',
        message: 'Group deleted successfully',
        userId,
        metadata: {
          groupId: id,
          groupName: result.groupName,
          groupType: result.groupType,
          deviceCount: result.imei?.length || 0,
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      if (
        !(error instanceof NotFoundException) &&
        !(error instanceof BadRequestException)
      ) {
        await this.sendLog({
          method: 'DELETE',
          url: `/groups/${id}`,
          statusCode: 400,
          operation: 'DELETE_GROUP',
          resource: 'groups',
          message: 'Unexpected error while deleting group',
          userId,
          metadata: { groupId: id },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });

        throw new BadRequestException(
          'Failed to delete group: ' + error.message,
        );
      }
      throw error;
    }
  }

  async findAllWithoutPagination(userId?: string): Promise<any[]> {
    const startTime = Date.now();

    try {
      const groups = await this.groupModel.aggregate([
        {
          $lookup: {
            from: 'deviceonboardings',
            localField: 'imei',
            foreignField: '_id',
            as: 'imei',
            pipeline: [
              { $project: { deviceId: 1, serialNumber: 1, modelName: 1 } },
            ],
          },
        },
        {
          $addFields: {
            deviceCount: { $size: '$imei' },
            deviceList: {
              $reduce: {
                input: '$imei',
                initialValue: '',
                in: {
                  $concat: [
                    '$$value',
                    { $cond: [{ $eq: ['$$value', ''] }, '', ', '] },
                    '$$this.deviceId',
                  ],
                },
              },
            },
          },
        },
        { $sort: { createdAt: -1 } },
      ]);

      await this.sendLog({
        method: 'GET',
        url: '/groups/export/data',
        statusCode: 200,
        operation: 'EXPORT_GROUPS_DATA',
        resource: 'groups',
        message: 'Groups export data retrieved successfully',
        userId,
        metadata: {
          totalGroups: groups.length,
        },
        responseTime: Date.now() - startTime,
      });

      return groups;
    } catch (error) {
      await this.sendLog({
        method: 'GET',
        url: '/groups/export/data',
        statusCode: 500,
        operation: 'EXPORT_GROUPS_DATA',
        resource: 'groups',
        message: 'Failed to retrieve groups export data',
        userId,
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      throw error;
    }
  }

  exportToPDF(groups: any[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      // Create a document with landscape orientation for better width
      const doc = new PDFDocument({
        margin: 20,
        size: 'A4',
        layout: 'landscape',
      });

      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=groups.pdf');

      doc.pipe(res);

      // Title
      doc.fontSize(16).text('Groups List', { align: 'center' }).moveDown(1);

      // Calculate available width
      const pageWidth =
        doc.page.width - (doc.page.margins.left + doc.page.margins.right);

      // Define table structure with better width distribution
      const table = {
        headers: [
          { label: 'Group Name', width: pageWidth * 0.18 },
          { label: 'Group Type', width: pageWidth * 0.12 },
          { label: 'State', width: pageWidth * 0.12 },
          { label: 'City', width: pageWidth * 0.12 },
          { label: 'Contact No', width: pageWidth * 0.13 },
          { label: 'Device Count', width: pageWidth * 0.1 },
          { label: 'Remark', width: pageWidth * 0.23 },
        ],
        rows: groups.map((group) => [
          group.groupName || '',
          group.groupType || '',
          group.stateName || '',
          group.cityName || '',
          group.contactNo || '',
          group.deviceCount?.toString() || '0',
          group.remark || '',
        ]),
        rowHeight: 20,
        margin: { top: 30 },
      };

      // Table drawing position
      const startY = doc.y + table.margin.top;
      let currentY = startY;

      // Draw table headers with background
      doc.font('Helvetica-Bold').fontSize(9);
      let x = doc.page.margins.left;

      // Draw header background
      doc
        .rect(doc.page.margins.left, currentY - 2, pageWidth, table.rowHeight)
        .fill('#f0f0f0')
        .stroke();

      // Reset color for text
      doc.fillColor('black');

      table.headers.forEach((header, i) => {
        doc.text(header.label, x + 2, currentY + 3, {
          width: header.width - 4,
          align: 'left',
          ellipsis: true,
        });
        x += header.width;
      });

      currentY += table.rowHeight + 5;

      // Draw horizontal line under headers
      doc
        .moveTo(doc.page.margins.left, currentY - 3)
        .lineTo(doc.page.margins.left + pageWidth, currentY - 3)
        .stroke();

      // Draw table rows
      doc.font('Helvetica').fontSize(8);

      table.rows.forEach((row, rowIndex) => {
        // Check if we need a new page
        if (currentY > doc.page.height - doc.page.margins.bottom - 30) {
          doc.addPage();
          currentY = doc.page.margins.top;

          // Redraw headers on new page
          doc.font('Helvetica-Bold').fontSize(9);
          let headerX = doc.page.margins.left;

          doc
            .rect(
              doc.page.margins.left,
              currentY - 2,
              pageWidth,
              table.rowHeight,
            )
            .fill('#f0f0f0')
            .stroke();

          doc.fillColor('black');

          table.headers.forEach((header, i) => {
            doc.text(header.label, headerX + 2, currentY + 3, {
              width: header.width - 4,
              align: 'left',
              ellipsis: true,
            });
            headerX += header.width;
          });

          currentY += table.rowHeight + 5;
          doc.font('Helvetica').fontSize(8);
        }

        x = doc.page.margins.left;

        // Alternate row colors
        if (rowIndex % 2 === 0) {
          doc
            .rect(
              doc.page.margins.left,
              currentY - 2,
              pageWidth,
              table.rowHeight,
            )
            .fill('#f9f9f9')
            .stroke();
          doc.fillColor('black');
        }

        // Draw each cell in the row
        row.forEach((cell, colIndex) => {
          doc.text(String(cell), x + 2, currentY + 2, {
            width: table.headers[colIndex].width - 4,
            height: table.rowHeight - 4,
            align: 'left',
            ellipsis: true,
          });
          x += table.headers[colIndex].width;
        });

        currentY += table.rowHeight;
      });

      // Add footer with page numbers
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc
          .fontSize(8)
          .text(
            `Page ${i + 1} of ${pages.count}`,
            doc.page.margins.left,
            doc.page.height - doc.page.margins.bottom + 10,
            { align: 'center' },
          );
      }

      doc.end();

      // Log successful PDF export
      this.sendLog({
        method: 'GET',
        url: '/groups/export/pdf',
        statusCode: 200,
        operation: 'EXPORT_GROUPS_PDF',
        resource: 'groups',
        message: 'Groups list exported to PDF successfully',
        userId,
        metadata: {
          totalGroups: groups.length,
          exportFormat: 'PDF',
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      console.error('Error in exportToPDF:', error);

      this.sendLog({
        method: 'GET',
        url: '/groups/export/pdf',
        statusCode: 500,
        operation: 'EXPORT_GROUPS_PDF',
        resource: 'groups',
        message: 'Failed to export groups list to PDF',
        userId,
        metadata: {
          totalGroups: groups.length,
          exportFormat: 'PDF',
        },
        responseTime: Date.now() - startTime,
        isError: true,
        errorMessage: error.message,
        stackTrace: error.stack,
      });

      if (!res.headersSent) {
        res.status(500).send('Error generating PDF');
      }
    }
  }

  exportToCSV(groups: any[], res: Response, userId?: string): void {
    const startTime = Date.now();

    try {
      // Set response headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=groups_' +
          new Date().toISOString().slice(0, 10) +
          '.csv',
      );

      // CSV configuration
      const csvStream = format({
        headers: [
          'Group Name',
          'Group Type',
          'State Name',
          'City Name',
          'Contact No',
          'Device Count',
          'Device List',
          'Remark',
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
      groups.forEach((group) => {
        csvStream.write({
          'Group Name': group.groupName || 'N/A',
          'Group Type': group.groupType || 'N/A',
          'State Name': group.stateName || 'N/A',
          'City Name': group.cityName || 'N/A',
          'Contact No': group.contactNo || 'N/A',
          'Device Count': group.deviceCount || 0,
          'Device List': group.deviceList || 'N/A',
          Remark: group.remark || 'N/A',
          'Created At': group.createdAt
            ? new Date(group.createdAt).toLocaleString()
            : 'N/A',
          'Updated At': group.updatedAt
            ? new Date(group.updatedAt).toLocaleString()
            : 'N/A',
        });
      });

      // Handle stream events
      csvStream.on('error', (error) => {
        console.error('CSV stream error:', error);

        this.sendLog({
          method: 'GET',
          url: '/groups/export/csv',
          statusCode: 500,
          operation: 'EXPORT_GROUPS_CSV',
          resource: 'groups',
          message: 'CSV stream error during export',
          userId,
          metadata: {
            totalGroups: groups.length,
            exportFormat: 'CSV',
          },
          responseTime: Date.now() - startTime,
          isError: true,
          errorMessage: error.message,
          stackTrace: error.stack,
        });

        if (!res.headersSent) {
          res.status(500).send('Error generating CSV');
        }
      });

      csvStream.on('end', () => {
        console.log('CSV export completed successfully');

        this.sendLog({
          method: 'GET',
          url: '/groups/export/csv',
          statusCode: 200,
          operation: 'EXPORT_GROUPS_CSV',
          resource: 'groups',
          message: 'Groups list exported to CSV successfully',
          userId,
          metadata: {
            totalGroups: groups.length,
            exportFormat: 'CSV',
          },
          responseTime: Date.now() - startTime,
        });
      });

      csvStream.end();
    } catch (error) {
      console.error('Error in exportToCSV:', error);

      this.sendLog({
        method: 'GET',
        url: '/groups/export/csv',
        statusCode: 500,
        operation: 'EXPORT_GROUPS_CSV',
        resource: 'groups',
        message: 'Failed to export groups list to CSV',
        userId,
        metadata: {
          totalGroups: groups.length,
          exportFormat: 'CSV',
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
    groups: any[],
    res: Response,
    userId?: string,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Groups Management System';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Groups', {
        pageSetup: {
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
        },
      });

      // Define columns with specific widths and styles
      worksheet.columns = [
        {
          header: 'Group Name',
          key: 'groupName',
          width: 25,
          style: { numFmt: '@' },
        },
        { header: 'Group Type', key: 'groupType', width: 20 },
        { header: 'State Name', key: 'stateName', width: 20 },
        { header: 'City Name', key: 'cityName', width: 20 },
        { header: 'Contact No', key: 'contactNo', width: 15 },
        { header: 'Device Count', key: 'deviceCount', width: 15 },
        { header: 'Device List', key: 'deviceList', width: 40 },
        { header: 'Remark', key: 'remark', width: 30 },
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
      groups.forEach((group) => {
        const row = worksheet.addRow({
          groupName: group.groupName || 'N/A',
          groupType: group.groupType || 'N/A',
          stateName: group.stateName || 'N/A',
          cityName: group.cityName || 'N/A',
          contactNo: group.contactNo || 'N/A',
          deviceCount: group.deviceCount || 0,
          deviceList: group.deviceList || 'N/A',
          remark: group.remark || 'N/A',
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
        });

        // Style the data rows
        row.eachCell((cell: any, colNumber) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };

          // Highlight rows with devices
          if (colNumber === 6 && cell.value > 0) {
            // Device Count column
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFC6EFCE' }, // Light green
            };
          }

          // Wrap text for device list and remark columns
          if (colNumber === 7 || colNumber === 8) {
            // Device List and Remark columns
            cell.alignment = {
              wrapText: true,
              vertical: 'top',
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
        `attachment; filename=groups_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );

      await workbook.xlsx.write(res);
      res.end();

      await this.sendLog({
        method: 'GET',
        url: '/groups/export/xlsx',
        statusCode: 200,
        operation: 'EXPORT_GROUPS_XLSX',
        resource: 'groups',
        message: 'Groups list exported to XLSX successfully',
        userId,
        metadata: {
          totalGroups: groups.length,
          exportFormat: 'XLSX',
        },
        responseTime: Date.now() - startTime,
      });
    } catch (error) {
      console.error('Error exporting to XLSX:', error);

      await this.sendLog({
        method: 'GET',
        url: '/groups/export/xlsx',
        statusCode: 500,
        operation: 'EXPORT_GROUPS_XLSX',
        resource: 'groups',
        message: 'Failed to export groups list to XLSX',
        userId,
        metadata: {
          totalGroups: groups.length,
          exportFormat: 'XLSX',
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
}
