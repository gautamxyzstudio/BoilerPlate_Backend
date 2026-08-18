/**
 * service-varient controller
 */

import { factories } from '@strapi/strapi';

const UID = 'api::service-varient.service-varient';
const SERVICE_UID = 'api::service.service';
const PRICING_UID = 'api::service-pricing.service-pricing';

export default factories.createCoreController(UID, ({ strapi }) => ({
  /**
   * Create a new Service Variant with parent Service & Service Pricing
   */
  async create(ctx) {
    const trx = await strapi.db.transaction();

    try {
      const body = ctx.request.body?.data || ctx.request.body;

      const {
        name,
        service,
        image,
        isActive = true,
        expressDeliveryAvailable = true,
        displayOrder = 0,
        price,
        offerPrice,
        expressDeliveryPrice,
        pricing,
        service_pricing,
      } = body;

      // Extract service document ID
      let serviceId = service;
      if (typeof service === 'object' && service !== null) {
        serviceId = service.documentId || service.id || service.connect?.[0]?.documentId || service.connect?.[0];
      }

      // Extract pricing fields
      const finalPrice = price !== undefined ? price : (pricing?.price ?? service_pricing?.price);
      const finalOfferPrice = offerPrice !== undefined ? offerPrice : (pricing?.offerPrice ?? service_pricing?.offerPrice);
      const finalExpressPrice = expressDeliveryPrice !== undefined ? expressDeliveryPrice : (pricing?.expressDeliveryPrice ?? service_pricing?.expressDeliveryPrice);

      // Validations
      if (!name) {
        throw new Error('Variant name is required.');
      }

      if (!serviceId) {
        throw new Error('Parent service is required.');
      }

      // Verify parent service exists
      const existingService = await strapi.documents(SERVICE_UID).findOne({
        documentId: serviceId,
      });

      if (!existingService) {
        throw new Error(`Service with ID "${serviceId}" not found.`);
      }

      if (finalPrice === undefined || finalPrice === null || finalPrice === '') {
        throw new Error('Price is required for variant.');
      }

      // Create Service Variant
      const createdVariant = await strapi.documents(UID).create({
        data: {
          name,
          image,
          service: existingService.documentId,
          isActive,
          expressDeliveryAvailable,
          displayOrder,
        },
        transaction: trx,
      });

      // Create Service Pricing
      await strapi.documents(PRICING_UID).create({
        data: {
          service_varient: createdVariant.documentId,
          service: existingService.documentId,
          price: finalPrice,
          offerPrice: finalOfferPrice,
          expressDeliveryPrice: finalExpressPrice,
          isActive: true,
        },
        transaction: trx,
      });

      await trx.commit();

      // Fetch created variant with populated fields
      const response = await strapi.documents(UID).findOne({
        documentId: createdVariant.documentId,
        populate: {
          image: true,
          service: true,
          service_pricings: true,
        },
      });

      return ctx.send({
        message: 'Service variant created successfully.',
        data: response,
      });
    } catch (error: any) {
      await trx.rollback();
      strapi.log.error('Error creating service variant:', error);
      return ctx.badRequest(error?.message || 'Failed to create service variant.');
    }
  },

  /**
   * Update an existing Service Variant along with Service relation & Service Pricing
   */
  async update(ctx) {
    const trx = await strapi.db.transaction();

    try {
      const documentId = ctx.params.id;
      const body = ctx.request.body?.data || ctx.request.body;

      const {
        name,
        service,
        image,
        isActive,
        expressDeliveryAvailable,
        displayOrder,
        price,
        offerPrice,
        expressDeliveryPrice,
        pricing,
        service_pricing,
      } = body;

      // ===========================
      // 1. Find Existing Variant
      // ===========================

      const existingVariant = await strapi.documents(UID).findOne({
        documentId,
        populate: {
          image: true,
          service: true,
          service_pricings: true,
        },
      });

      if (!existingVariant) {
        throw new Error('Service variant not found.');
      }

      // ===========================
      // 2. Validate & Extract Parent Service
      // ===========================

      let serviceId = service;
      if (typeof service === 'object' && service !== null) {
        serviceId = service.documentId || service.id || service.connect?.[0]?.documentId || service.connect?.[0];
      }

      if (serviceId) {
        const checkService = await strapi.documents(SERVICE_UID).findOne({
          documentId: serviceId,
        });
        if (!checkService) {
          throw new Error(`Service with ID "${serviceId}" not found.`);
        }
        serviceId = checkService.documentId;
      }

      // ===========================
      // 3. Update Service Variant
      // ===========================

      const updateData: Record<string, any> = {};
      if (name !== undefined) updateData.name = name;
      if (image !== undefined) updateData.image = image;
      if (serviceId !== undefined) updateData.service = serviceId;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (expressDeliveryAvailable !== undefined) updateData.expressDeliveryAvailable = expressDeliveryAvailable;
      if (displayOrder !== undefined) updateData.displayOrder = displayOrder;

      if (Object.keys(updateData).length > 0) {
        await strapi.documents(UID).update({
          documentId: existingVariant.documentId,
          data: updateData,
          transaction: trx,
        });
      }

      // ===========================
      // 4. Update / Create Service Pricing
      // ===========================

      const finalPrice = price !== undefined ? price : (pricing?.price ?? service_pricing?.price);
      const finalOfferPrice = offerPrice !== undefined ? offerPrice : (pricing?.offerPrice ?? service_pricing?.offerPrice);
      const finalExpressPrice = expressDeliveryPrice !== undefined ? expressDeliveryPrice : (pricing?.expressDeliveryPrice ?? service_pricing?.expressDeliveryPrice);

      const existingPricing = existingVariant.service_pricings?.[0];

      if (existingPricing) {
        const pricingUpdateData: Record<string, any> = {};
        if (finalPrice !== undefined) pricingUpdateData.price = finalPrice;
        if (finalOfferPrice !== undefined) pricingUpdateData.offerPrice = finalOfferPrice;
        if (finalExpressPrice !== undefined) pricingUpdateData.expressDeliveryPrice = finalExpressPrice;
        if (serviceId !== undefined) pricingUpdateData.service = serviceId;
        if (isActive !== undefined) pricingUpdateData.isActive = isActive;

        if (Object.keys(pricingUpdateData).length > 0) {
          await strapi.documents(PRICING_UID).update({
            documentId: existingPricing.documentId,
            data: pricingUpdateData,
            transaction: trx,
          });
        }
      } else if (finalPrice !== undefined) {
        const parentServiceDocId = serviceId || (existingVariant.service as any)?.documentId;
        await strapi.documents(PRICING_UID).create({
          data: {
            service_varient: existingVariant.documentId,
            service: parentServiceDocId,
            price: finalPrice,
            offerPrice: finalOfferPrice,
            expressDeliveryPrice: finalExpressPrice,
            isActive: isActive ?? true,
          },
          transaction: trx,
        });
      }

      // ===========================
      // 5. Commit Transaction
      // ===========================

      await trx.commit();

      // ===========================
      // 6. Collect Updated Fields & Send Response
      // ===========================

      const updatedFields: string[] = [];
      if (name !== undefined) updatedFields.push('name');
      if (image !== undefined) updatedFields.push('image');
      if (serviceId !== undefined) updatedFields.push('service');
      if (isActive !== undefined) updatedFields.push('isActive');
      if (expressDeliveryAvailable !== undefined) updatedFields.push('expressDeliveryAvailable');
      if (displayOrder !== undefined) updatedFields.push('displayOrder');
      if (finalPrice !== undefined) updatedFields.push('price');
      if (finalOfferPrice !== undefined) updatedFields.push('offerPrice');
      if (finalExpressPrice !== undefined) updatedFields.push('expressDeliveryPrice');

      return ctx.send({
        message: 'Service variant updated successfully.',
        updatedFields,
      });
    } catch (error: any) {
      await trx.rollback();
      strapi.log.error('Error updating service variant:', error);
      return ctx.badRequest(error?.message || 'Failed to update service variant.');
    }
  },

  /**
   * Find Many Service Variants with populated relations
   */
  async find(ctx) {
    try {
      const { query } = ctx;
      const variants = await strapi.documents(UID).findMany({
        ...query,
        populate: {
          image: true,
          service: true,
          service_pricings: true,
          ...(typeof query?.populate === 'object' ? query.populate : {}),
        },
      });

      return ctx.send({ data: variants });
    } catch (error: any) {
      strapi.log.error('Error fetching service variants:', error);
      return ctx.badRequest(error?.message || 'Failed to fetch service variants.');
    }
  },

  /**
   * Find One Service Variant by documentId
   */
  async findOne(ctx) {
    try {
      const { id: documentId } = ctx.params;
      const variant = await strapi.documents(UID).findOne({
        documentId,
        populate: {
          image: true,
          service: true,
          service_pricings: true,
        },
      });

      if (!variant) {
        return ctx.notFound('Service variant not found.');
      }

      return ctx.send({ data: variant });
    } catch (error: any) {
      strapi.log.error('Error fetching service variant:', error);
      return ctx.badRequest(error?.message || 'Failed to fetch service variant.');
    }
  },

  /**
   * Delete Service Variant and clean up linked pricing entries
   */
  async delete(ctx) {
    const trx = await strapi.db.transaction();

    try {
      const { id: documentId } = ctx.params;

      const variant = await strapi.documents(UID).findOne({
        documentId,
        populate: {
          service_pricings: true,
        },
      });

      if (!variant) {
        return ctx.notFound('Service variant not found.');
      }

      // Delete associated pricing entries
      for (const pricing of variant.service_pricings || []) {
        await strapi.documents(PRICING_UID).delete({
          documentId: pricing.documentId,
          transaction: trx,
        });
      }

      // Delete variant
      await strapi.documents(UID).delete({
        documentId: variant.documentId,
        transaction: trx,
      });

      await trx.commit();

      return ctx.send({
        message: 'Service variant deleted successfully.',
      });
    } catch (error: any) {
      await trx.rollback();
      strapi.log.error('Error deleting service variant:', error);
      return ctx.badRequest(error?.message || 'Failed to delete service variant.');
    }
  },
}));

