import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { T } from '@deity/falcon-i18n';
import { H1, H2, Box, Link, Button, Divider, FlexLayout } from '@deity/falcon-ui';
import {
  AddressesListQuery,
  AddressCardLayout,
  AddressDetails,
  AddressesListLayout,
  RemoveAddressMutation
} from '@deity/falcon-ecommerce-uikit';

const AddressBook = () => (
  <Box>
    <H1>
      <T id="addressBook.title" />
    </H1>
    <AddressesListQuery>
      {({ addresses: { items } }) => {
        const defaultBilling = items.find(x => x.defaultBilling) || {};
        const defaultShipping = items.find(x => x.defaultShipping) || {};
        const restAddresses = items.filter(x => !x.defaultBilling && !x.defaultShipping) || [];
        const anyDefaults = defaultBilling || defaultShipping;
        const defaultsEqual = (defaultBilling && defaultBilling.id) === (defaultShipping && defaultShipping.id);

        return (
          <>
            {anyDefaults && (
              <>
                <AddressesListLayout>
                  {defaultsEqual ? (
                    <AddressCardLayout>
                      <H2>
                        <T id="addressBook.defaultBillingAndShipping" />
                      </H2>
                      <AddressCardContent address={defaultBilling} />
                    </AddressCardLayout>
                  ) : (
                    <>
                      {defaultBilling && (
                        <AddressCardLayout>
                          <H2>
                            <T id="addressBook.defaultBilling" />
                          </H2>
                          <AddressCardContent address={defaultBilling} />
                        </AddressCardLayout>
                      )}
                      {defaultShipping && (
                        <AddressCardLayout>
                          <H2>
                            <T id="addressBook.defaultShipping" />
                          </H2>
                          <AddressCardContent address={defaultShipping} />
                        </AddressCardLayout>
                      )}
                    </>
                  )}
                </AddressesListLayout>
                <Divider my="lg" />
              </>
            )}
            <AddressesListLayout gridTemplateColumns={{ md: 'repeat(3, 1fr)' }} my="lg">
              {restAddresses.map(x => (
                <AddressCardLayout key={x.id}>
                  <AddressCardContent address={x} />
                </AddressCardLayout>
              ))}
            </AddressesListLayout>
            <FlexLayout flexDirection="column" alignItems="center" p="sm">
              <Button as={RouterLink} to="/account/address-book/add" flex={1}>
                <T id="addressBook.addNewButton" />
              </Button>
            </FlexLayout>
          </>
        );
      }}
    </AddressesListQuery>
  </Box>
);

export default AddressBook;

const AddressCardContent = ({ address }) => (
  <>
    <AddressDetails {...address} />
    <Box>
      <EditAddressLink id={address.id} /> | <RemoveAddressLink id={address.id} />
    </Box>
  </>
);

const EditAddressLink = ({ id }) => (
  <Link as={RouterLink} to={`/account/address-book/edit/${id}`} flex={1}>
    Edit
  </Link>
);

const RemoveAddressLink = ({ id }) => (
  <RemoveAddressMutation>
    {(removeAddress /* , { loading, error } */) => (
      <Link onClick={() => removeAddress({ variables: { id } })} flex={1}>
        Delete
      </Link>
    )}
  </RemoveAddressMutation>
);
