import gql from 'graphql-tag';
import { Query } from '../Query';

export type Product = {
  id: string;
  sku: string;
  name: string;
  image?: string;
  urlPath: string;
  thumbnail?: string;
  price: ProductPrice;
  priceType: string;
  tierPrices?: ProductTierPrice[];
  currency: string;
  description: string;
  stock: any; // Stock
  type: string;
  configurableOptions: []; // [ConfigurableProductOption]
  bundleOptions: []; // [BundleProductOption]
  gallery: []; // [GalleryEntry]
  seo: any; // ProductSeo
};

export type ProductPrice = {
  regular: number;
  special?: number;
  minTier?: number;
};

export type ProductTierPrice = {
  qty: number;
  value: number;
};

export const GET_PRODUCT = gql`
  query Product($id: String!, $path: String!) {
    product(id: $id) {
      id
      sku
      name
      description
      price {
        regular
        special
        minTier
      }
      currency
      gallery {
        full
        thumbnail
      }
      configurableOptions {
        id
        attributeId
        label
        productId
        values {
          valueIndex
          label
          inStock
        }
      }
      seo {
        title
        description
        keywords
      }
      breadcrumbs(path: $path) {
        name
        urlPath
      }
    }
  }
`;

export class ProductQuery extends Query<{ product: Product }> {
  static defaultProps = {
    query: GET_PRODUCT
  };
}
